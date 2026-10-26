import { beforeEach, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createTestPrisma, resetTestDb } from "./testDb";

// These tests mock `authenticate.webhook`. HMAC verification itself is performed by
// @shopify/shopify-app-react-router and is NOT exercised here (needs a live signed request).
const state = vi.hoisted(() => ({ webhook: vi.fn(), prisma: null as unknown }));

vi.mock("../app/shopify.server", () => ({
  authenticate: { webhook: (...a: unknown[]) => state.webhook(...a) },
  unauthenticated: { admin: vi.fn(async () => { throw new Error("no session"); }) },
}));
vi.mock("../app/db.server", () => ({
  default: new Proxy({}, { get: (_t, k) => (state.prisma as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("../app/bundles/index.server", async () => {
  const { createBundleRepo: c } = await import("../app/bundles/repo.server");
  return {
    bundleRepo: new Proxy({}, { get: (_t, k) => (c(state.prisma as never) as never as Record<string | symbol, unknown>)[k] }),
    syncForShop: vi.fn(),
  };
});

const input = {
  name: "A",
  status: "active" as const,
  pricingKind: "percentage" as const,
  pricingValue: 1000,
  items: [
    { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 },
    { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 1 },
  ],
};
let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => {
  const p = await createTestPrisma();
  await resetTestDb(p);
  await p.session.deleteMany();
  state.prisma = p;
  repo = createBundleRepo(p);
  state.webhook.mockReset();
});
const req = () => new Request("http://x/webhooks", { method: "POST" });

test("compliance: invalid signature (authenticate throws 401) never reaches handlers", async () => {
  await repo.create("a.myshopify.com", "USD", input);
  state.webhook.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
  const { action } = await import("../app/routes/webhooks.compliance");
  await expect(action({ request: req() } as never)).rejects.toMatchObject({ status: 401 });
  expect(await repo.list("a.myshopify.com")).toHaveLength(1);
});
test("compliance: customer topics acknowledge without touching data", async () => {
  await repo.create("a.myshopify.com", "USD", input);
  const { action } = await import("../app/routes/webhooks.compliance");
  for (const topic of ["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT"]) {
    state.webhook.mockResolvedValue({ shop: "a.myshopify.com", topic, payload: {} });
    expect((await action({ request: req() } as never) as Response).status).toBe(200);
  }
  expect(await repo.list("a.myshopify.com")).toHaveLength(1);
});
test("compliance: shop/redact purges bundles and sessions, replay is safe", async () => {
  await repo.create("a.myshopify.com", "USD", input);
  await repo.create("b.myshopify.com", "USD", { ...input });
  const p = state.prisma as Awaited<ReturnType<typeof createTestPrisma>>;
  await p.session.create({ data: { id: "s1", shop: "a.myshopify.com", state: "x", accessToken: "t" } });
  state.webhook.mockResolvedValue({ shop: "a.myshopify.com", topic: "SHOP_REDACT", payload: {} });
  const { action } = await import("../app/routes/webhooks.compliance");
  expect(((await action({ request: req() } as never)) as Response).status).toBe(200);
  expect(((await action({ request: req() } as never)) as Response).status).toBe(200);
  expect(await repo.list("a.myshopify.com")).toEqual([]);
  expect(await p.session.count({ where: { shop: "a.myshopify.com" } })).toBe(0);
  expect(await repo.list("b.myshopify.com")).toHaveLength(1);
});
test("products/delete: pauses affected bundles and still returns 200 without an offline session", async () => {
  const a = await repo.create("a.myshopify.com", "USD", input);
  state.webhook.mockResolvedValue({ shop: "a.myshopify.com", topic: "PRODUCTS_DELETE", payload: { id: 1 } });
  const { action } = await import("../app/routes/webhooks.products.delete");
  expect(((await action({ request: req() } as never)) as Response).status).toBe(200);
  expect((await repo.get("a.myshopify.com", a.id))!.status).toBe("paused");
});
