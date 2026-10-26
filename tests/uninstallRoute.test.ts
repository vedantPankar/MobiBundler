import { beforeEach, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createRevenueRepo } from "../app/bundles/revenue.repo.server";
import { syncOrders } from "../app/bundles/revenueSync.server";
import { createTestPrisma, resetTestDb } from "./testDb";

// authenticate.webhook is mocked (HMAC is covered in webhookSignature.test.ts).
const state = vi.hoisted(() => ({ webhook: vi.fn(), prisma: null as unknown }));
vi.mock("../app/shopify.server", () => ({ authenticate: { webhook: (...a: unknown[]) => state.webhook(...a) } }));
vi.mock("../app/db.server", () => ({
  default: new Proxy({}, { get: (_t, k) => (state.prisma as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("../app/bundles/index.server", async () => {
  const { createBundleRepo: c } = await import("../app/bundles/repo.server");
  return { bundleRepo: new Proxy({}, { get: (_t, k) => (c(state.prisma as never) as never as Record<string | symbol, unknown>)[k] }) };
});

const [A, B] = ["a.myshopify.com", "b.myshopify.com"];
const V1 = "gid://shopify/ProductVariant/1";
const V2 = "gid://shopify/ProductVariant/2";
const order = (id: string) => ({
  id, createdAt: new Date(Date.now() + 60_000).toISOString(), updatedAt: new Date().toISOString(), cancelledAt: null, currencyCode: "USD",
  lineItems: { pageInfo: { hasNextPage: false }, nodes: [
    { id: "L1", quantity: 1, currentQuantity: 1, variant: { id: V1 }, originalUnitPriceSet: { shopMoney: { amount: "10.00", currencyCode: "USD" } }, discountAllocations: [] },
    { id: "L2", quantity: 1, currentQuantity: 1, variant: { id: V2 }, originalUnitPriceSet: { shopMoney: { amount: "20.00", currencyCode: "USD" } }, discountAllocations: [] },
  ] },
  refunds: [],
});

beforeEach(async () => {
  const p = await createTestPrisma();
  await resetTestDb(p);
  await p.session.deleteMany();
  state.prisma = p;
  state.webhook.mockReset();
  const bundles = createBundleRepo(p);
  const repo = createRevenueRepo(p);
  for (const shop of [A, B]) {
    await bundles.create(shop, "USD", {
      name: "Pair", status: "active", pricingKind: "percentage", pricingValue: 1000,
      items: [{ productId: "gid://shopify/Product/1", variantId: V1, quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: V2, quantity: 1 }],
    });
    await syncOrders({ shop, repo, bundleRepo: bundles, fetchPage: async () => ({ orders: [order(`gid://shopify/Order/${shop}`)], hasNext: false, endCursor: null }) });
  }
});

test("uninstalling removes the shop's bundles AND all revenue data, leaves other shops alone, and is replay-safe", async () => {
  const p = state.prisma as Awaited<ReturnType<typeof createTestPrisma>>;
  expect(await p.bundleOrderRevenue.count({ where: { shop: A } })).toBe(1);
  state.webhook.mockResolvedValue({ shop: A, topic: "APP_UNINSTALLED", session: undefined });
  const { action } = await import("../app/routes/webhooks.app.uninstalled.jsx");
  for (let i = 0; i < 2; i++) expect(((await action({ request: new Request("http://x", { method: "POST" }) } as never)) as Response).status).toBe(200);
  for (const table of [p.bundle, p.orderRecord, p.bundleOrderRevenue, p.revenueSyncState] as { count: (a: object) => Promise<number> }[]) {
    expect(await table.count({ where: { shop: A } })).toBe(0);
  }
  expect(await p.bundleOrderRevenue.count({ where: { shop: B } })).toBe(1);
  expect(await p.orderRecord.count({ where: { shop: B } })).toBe(1);
});
