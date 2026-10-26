import { beforeEach, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createTestPrisma, resetTestDb } from "./testDb";

// authenticate.public.appProxy is mocked: Shopify's proxy signature check is done by the library (see
// webhookSignature.test.ts for the same approach with real HMAC on webhooks). These tests cover what the route does
// with a verified shop and untrusted query parameters.
const state = vi.hoisted(() => ({ session: null as unknown, prisma: null as unknown, fail: false }));
vi.mock("../app/shopify.server", () => ({
  authenticate: { public: { appProxy: async () => ({ session: state.session }) } },
  unauthenticated: { admin: async () => ({ admin: {} }) },
}));
vi.mock("../app/bundles/index.server", async () => {
  const { createBundleRepo: c } = await import("../app/bundles/repo.server");
  return { bundleRepo: new Proxy({}, { get: (_t, k) => (c(state.prisma as never) as never as Record<string | symbol, unknown>)[k] }) };
});
vi.mock("../app/bundles/publicBundles.server", () => ({
  getPublicBundles: async (d: { shop: string; ids: string[] }) => {
    if (state.fail) throw new Error("shopify down");
    return d.ids.map((id) => ({ id, shop: d.shop }));
  },
}));

const A = "a.myshopify.com";
const input = (name: string, v: number[]) => ({
  name,
  status: "active" as const,
  pricingKind: "percentage" as const,
  pricingValue: 1000,
  items: v.map((n) => ({ productId: `gid://shopify/Product/${n}`, variantId: `gid://shopify/ProductVariant/${n}`, quantity: 1 })),
});
let ids: { fbt: string; other: string };
const call = async (qs: string) => {
  const { loader } = await import("../app/routes/app_proxy.bundles");
  const res = (await loader({ request: new Request(`https://x/apps/mobi-bundler/bundles?${qs}`) } as never)) as Response;
  return { status: res.status, body: (await res.json()) as { bundles: { id: string; shop: string }[]; error?: string } };
};

beforeEach(async () => {
  const p = await createTestPrisma();
  await resetTestDb(p);
  state.prisma = p;
  state.session = { shop: A };
  state.fail = false;
  const repo = createBundleRepo(p);
  ids = { fbt: (await repo.create(A, "USD", input("FBT", [1, 2]))).id, other: (await repo.create("b.myshopify.com", "USD", input("Other", [1, 2]))).id };
});

test("a product id resolves to this shop's active bundle that contains it", async () => {
  const r = await call("product=1");
  expect(r.body.bundles.map((b) => b.id)).toEqual([ids.fbt]);
  expect(r.body.bundles[0].shop).toBe(A);
});

test("a product in no bundle, and another shop's bundle, return nothing", async () => {
  expect((await call("product=99")).body.bundles).toEqual([]);
  state.session = { shop: "c.myshopify.com" };
  expect((await call("product=1")).body.bundles).toEqual([]);
});

test("explicit ids still work; malformed ids and products are dropped, not passed through", async () => {
  expect((await call(`ids=${ids.fbt}`)).body.bundles.map((b) => b.id)).toEqual([ids.fbt]);
  expect((await call("ids=a%2Fb,../../etc,ok_1")).body.bundles.map((b) => b.id)).toEqual(["ok_1"]);
  expect((await call("product=1;DROP")).body.bundles).toEqual([]);
  expect((await call("")).body.bundles).toEqual([]);
});

test("an unsigned request (no session) gets an empty list", async () => {
  state.session = null;
  expect((await call("product=1")).body.bundles).toEqual([]);
});

test("Shopify failing returns a 502 with a generic error and never leaks details", async () => {
  state.fail = true;
  const r = await call("product=1");
  expect(r.status).toBe(502);
  expect(r.body).toEqual({ bundles: [], error: "unavailable" });
});
