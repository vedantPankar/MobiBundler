import { beforeEach, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createRevenueRepo } from "../app/bundles/revenue.repo.server";
import { ingestOrderById } from "../app/bundles/revenueSync.server";
import { createTestPrisma, resetTestDb } from "./testDb";

// authenticate.webhook is mocked: HMAC verification itself is done by @shopify/shopify-app-react-router and is NOT
// exercised here. These tests cover what the route does once a webhook is verified (or fails verification).
const state = vi.hoisted(() => ({
  webhook: vi.fn(),
  admin: vi.fn(),
  prisma: null as unknown,
  order: null as unknown,
}));
vi.mock("../app/shopify.server", () => ({
  authenticate: { webhook: (...a: unknown[]) => state.webhook(...a) },
  unauthenticated: { admin: (...a: unknown[]) => state.admin(...a) },
}));
vi.mock("../app/bundles/index.server", async () => {
  const { createBundleRepo: cb } = await import("../app/bundles/repo.server");
  const { createRevenueRepo: cr } = await import("../app/bundles/revenue.repo.server");
  const { ingestOrderById: ingest } = await import("../app/bundles/revenueSync.server");
  return {
    ingestOrderForShop: (shop: string, _admin: unknown, orderGid: string) =>
      ingest({
        shop,
        orderGid,
        repo: cr(state.prisma as never),
        bundleRepo: cb(state.prisma as never),
        fetchOrder: async () => state.order as never,
      }),
  };
});

const S = "a.myshopify.com";
const OXY = "gid://shopify/ProductVariant/1";
const LIQ = "gid://shopify/ProductVariant/2";
const order = (cancelledAt: string | null = null) => ({
  id: "gid://shopify/Order/1001",
  createdAt: new Date(Date.now() + 60_000).toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAt,
  currencyCode: "USD",
  lineItems: {
    pageInfo: { hasNextPage: false },
    nodes: [
      { id: "L1", quantity: 1, currentQuantity: 1, variant: { id: OXY }, originalUnitPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } }, discountAllocations: [] },
      { id: "L2", quantity: 1, currentQuantity: 1, variant: { id: LIQ }, originalUnitPriceSet: { shopMoney: { amount: "50.00", currencyCode: "USD" } }, discountAllocations: [] },
    ],
  },
  refunds: [],
});
const req = () => new Request("http://x/webhooks", { method: "POST" });
const verified = (topic: string, payload: object) => state.webhook.mockResolvedValue({ shop: S, topic, payload });
const rows = () => (state.prisma as Awaited<ReturnType<typeof createTestPrisma>>).bundleOrderRevenue.findMany();

beforeEach(async () => {
  const p = await createTestPrisma();
  await resetTestDb(p);
  state.prisma = p;
  state.webhook.mockReset();
  state.admin.mockReset().mockResolvedValue({ admin: {} });
  state.order = order();
  await createBundleRepo(p).create(S, "USD", {
    name: "Pair", status: "active", pricingKind: "percentage", pricingValue: 1000,
    items: [{ productId: "gid://shopify/Product/1", variantId: OXY, quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: LIQ, quantity: 1 }],
  });
});

test("an invalid signature (authenticate throws 401) never reaches ingestion", async () => {
  state.webhook.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
  const { action } = await import("../app/routes/webhooks.orders");
  await expect(action({ request: req() } as never)).rejects.toMatchObject({ status: 401 });
  expect(await rows()).toEqual([]);
});

test("orders/paid ingests the order by id; the same delivery twice changes nothing", async () => {
  verified("ORDERS_PAID", { id: 1001 });
  const { action } = await import("../app/routes/webhooks.orders");
  expect(((await action({ request: req() } as never)) as Response).status).toBe(200);
  const first = await rows();
  expect(first).toHaveLength(1);
  expect(((await action({ request: req() } as never)) as Response).status).toBe(200);
  expect(await rows()).toEqual(first);
});

test("refunds/create takes the order id from order_id and orders/cancelled zeroes the revenue", async () => {
  const { action } = await import("../app/routes/webhooks.orders");
  verified("ORDERS_PAID", { id: 1001 });
  await action({ request: req() } as never);
  state.order = order(new Date().toISOString());
  verified("ORDERS_CANCELLED", { id: 1001 });
  await action({ request: req() } as never);
  verified("REFUNDS_CREATE", { id: 555, order_id: 1001 });
  await action({ request: req() } as never);
  const [row] = await rows();
  expect(row).toMatchObject({ cancelled: true, netMinor: 0 });
});

test("unrelated topics and unusable ids are acknowledged without work (no pointless retries)", async () => {
  const { action } = await import("../app/routes/webhooks.orders");
  verified("PRODUCTS_UPDATE", { id: 1001 });
  expect(((await action({ request: req() } as never)) as Response).status).toBe(200);
  verified("ORDERS_PAID", { id: "not-a-number" });
  expect(((await action({ request: req() } as never)) as Response).status).toBe(200);
  verified("REFUNDS_CREATE", {});
  expect(((await action({ request: req() } as never)) as Response).status).toBe(200);
  expect(await rows()).toEqual([]);
});

test("no offline session (shop uninstalled) is acknowledged; a Shopify failure returns 500 so it is retried", async () => {
  const { action } = await import("../app/routes/webhooks.orders");
  verified("ORDERS_PAID", { id: 1001 });
  state.admin.mockRejectedValue(new Error("no session"));
  expect(((await action({ request: req() } as never)) as Response).status).toBe(200);
  state.admin.mockResolvedValue({ admin: {} });
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.order = new Proxy({}, { get: () => { throw new Error("boom"); } });
  expect(((await action({ request: req() } as never)) as Response).status).toBe(500);
});

test("ingestOrderById is exported for the route and is retry-safe", () => {
  expect(typeof ingestOrderById).toBe("function");
  expect(typeof createRevenueRepo).toBe("function");
});
