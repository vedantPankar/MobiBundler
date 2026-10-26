import { beforeEach, describe, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createRevenueRepo } from "../app/bundles/revenue.repo.server";
import { syncOrders } from "../app/bundles/revenueSync.server";
import { buildOrderRows } from "../app/bundles/orderRows";
import { BUNDLE_DISCOUNT_MESSAGE } from "../app/bundles/engine";
import type { RawOrder } from "../app/bundles/orderNormalizer";
import { createTestPrisma, resetTestDb } from "./testDb";

// Synthetic orders in the shape this app assumes (see orderNormalizer.ts); real order #1001 is covered in realOrder1001.test.ts.
const S = "a.myshopify.com";
const V1 = "gid://shopify/ProductVariant/1";
const V2 = "gid://shopify/ProductVariant/2";
const money = (a: string) => ({ shopMoney: { amount: a, currencyCode: "USD" } });
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
function order(n: number, o: { ageDays?: number; name?: string | null; refunded?: boolean; cancelled?: boolean; estimate?: boolean } = {}): RawOrder {
  const rec = o.estimate ? undefined : "1.00";
  const line = (id: string, v: string, price: string) => ({
    id: `L${n}${id}`, quantity: 1, currentQuantity: 1, variant: { id: v }, originalUnitPriceSet: money(price),
    discountAllocations: rec ? [{ allocatedAmountSet: money(id === "a" ? "1.00" : "2.00"), discountApplication: { __typename: "AutomaticDiscountApplication", title: BUNDLE_DISCOUNT_MESSAGE } }] : [],
  });
  return {
    id: `gid://shopify/Order/${n}`, ...(o.name === null ? {} : { name: o.name ?? `#${1000 + n}` }),
    createdAt: day(o.ageDays ?? -1), updatedAt: day(o.ageDays ?? -1), cancelledAt: o.cancelled ? day(0) : null, currencyCode: "USD",
    lineItems: { pageInfo: { hasNextPage: false }, nodes: [line("a", V1, "10.00"), line("b", V2, "20.00")] },
    refunds: o.refunded ? [{ id: `r${n}`, totalRefundedSet: money("5.00"), refundLineItems: { pageInfo: { hasNextPage: false }, nodes: [{ quantity: 1, lineItem: { id: `L${n}a` } }] } }] : [],
  };
}

let prisma: Awaited<ReturnType<typeof createTestPrisma>>;
let bundles: ReturnType<typeof createBundleRepo>;
let repo: ReturnType<typeof createRevenueRepo>;
const sync = (orders: RawOrder[], shop = S) => syncOrders({ shop, repo, bundleRepo: bundles, fetchPage: async () => ({ orders, hasNext: false, endCursor: null }) });
const page = (filter: Parameters<typeof repo.orderPage>[2]["filter"] = "all", p = 1, pageSize = 25, days = 60, shop = S) =>
  repo.orderPage(shop, new Date(Date.now() - days * 86_400_000), { filter, page: p, pageSize });

beforeEach(async () => {
  prisma = await createTestPrisma();
  await resetTestDb(prisma);
  bundles = createBundleRepo(prisma);
  repo = createRevenueRepo(prisma);
  await bundles.create(S, "USD", { name: "Pair", status: "active", pricingKind: "percentage", pricingValue: 1000,
    items: [{ productId: "gid://shopify/Product/1", variantId: V1, quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: V2, quantity: 1 }] });
  await bundles.create("b.myshopify.com", "USD", { name: "Pair", status: "active", pricingKind: "percentage", pricingValue: 1000,
    items: [{ productId: "gid://shopify/Product/1", variantId: V1, quantity: 1 }, { productId: "gid://shopify/Product/2", variantId: V2, quantity: 1 }] });
});

describe("order page query", () => {
  test("newest first, with each order's revenue rows, and only this shop's", async () => {
    await sync([order(1, { ageDays: 5 }), order(2, { ageDays: 1 }), order(3, { ageDays: 3 })]);
    await sync([order(9, { ageDays: 2 })], "b.myshopify.com");
    const { total, records, revenue } = await page();
    expect(total).toBe(3);
    expect(records.map((r) => r.orderName)).toEqual(["#1002", "#1003", "#1001"]);
    expect(revenue).toHaveLength(3);
    expect(records.every((r) => r.shop === S)).toBe(true);
  });

  test("period: orders older than the window are left out", async () => {
    await sync([order(1, { ageDays: 40 }), order(2, { ageDays: 3 })]);
    expect((await page("all", 1, 25, 7)).total).toBe(1);
    expect((await page("all", 1, 25, 60)).total).toBe(2);
  });

  test("filters: live, historical, estimates, refunded, cancelled", async () => {
    await sync([order(1, { ageDays: 2 })]); // placed after tracking began? no: tracking starts at first sync, order is older => historical
    const first = (await page()).records[0];
    expect(first.source).toBe("backfill");
    await sync([order(2, { ageDays: -1 }), order(3, { ageDays: -1, estimate: true }), order(4, { ageDays: -1, refunded: true }), order(5, { ageDays: -1, cancelled: true })]);
    const names = async (f: Parameters<typeof page>[0]) => (await page(f)).records.map((r) => r.orderName).sort();
    expect(await names("live")).toEqual(["#1002", "#1003", "#1004", "#1005"]);
    expect(await names("historical")).toEqual(["#1001"]);
    expect(await names("estimates")).toEqual(["#1003"]);
    expect(await names("refunded")).toEqual(["#1004"]);
    expect(await names("cancelled")).toEqual(["#1005"]);
    expect((await page("all")).total).toBe(5);
  });

  test("pagination: pages are disjoint, ordered, and cover everything", async () => {
    await sync([1, 2, 3, 4, 5].map((n) => order(n, { ageDays: n })));
    const p1 = await page("all", 1, 2);
    const p2 = await page("all", 2, 2);
    const p3 = await page("all", 3, 2);
    const ids = [...p1.records, ...p2.records, ...p3.records].map((r) => r.orderName);
    expect(ids).toEqual(["#1001", "#1002", "#1003", "#1004", "#1005"]);
    expect([p1.total, p2.total, p3.total]).toEqual([5, 5, 5]);
    expect((await page("all", 9, 2)).records).toEqual([]);
  });

  test("rows for display are built from the stored data", async () => {
    await sync([order(1, { ageDays: -1, refunded: true })]);
    const { records, revenue } = await page();
    const [r] = buildOrderRows(records, revenue, new Map([[(await bundles.list(S))[0].id, "Pair"]]));
    expect(r).toMatchObject({ label: "#1001", state: "partly_refunded", source: "live", unitsRefunded: 1 });
  });
});

describe("order number capture", () => {
  test("the order number is stored; an order stored without one is filled in by the next sync's re-check", async () => {
    await sync([order(1, { ageDays: -1, name: null })]);
    expect((await prisma.orderRecord.findFirst())!.orderName).toBeNull();
    const named = order(1, { ageDays: -1 });
    await syncOrders({ shop: S, repo, bundleRepo: bundles, fetchPage: async () => ({ orders: [], hasNext: false, endCursor: null }), fetchOrder: async () => named });
    expect((await prisma.orderRecord.findFirst())!.orderName).toBe("#1001");
  });
});
