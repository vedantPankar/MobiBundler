import { beforeEach, describe, expect, test } from "vitest";
import { buildAnalytics, dayRange, niceMax, percent, type AnalyticsRow } from "../app/bundles/analytics";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createTestPrisma, resetTestDb } from "./testDb";

const NOW = new Date("2026-10-25T12:00:00Z");
const SINCE = new Date("2026-10-19T12:00:00Z"); // 7 days
const names = new Map([["b1", "FBT"], ["b2", "Pair"]]);
const row = (over: Partial<AnalyticsRow> = {}): AnalyticsRow => ({
  orderId: "o1", bundleId: "b1", source: "live", cancelled: false, reconciled: true, unitsSold: 2, unitsRefunded: 0,
  soldGrossMinor: 177495, soldDiscountMinor: 17749, netMinor: 159746, orderedAt: new Date("2026-10-24T17:20:46Z"), ...over,
});
const run = (rows: AnalyticsRow[], events = {}) => buildAnalytics({ rows, events, since: SINCE, now: NOW, names });

describe("analytics numbers", () => {
  test("KPIs and the per-bundle funnel from rows and storefront counts", () => {
    const r = run([row()], { b1: { view: 40, add_to_cart: 10 } });
    expect(r.kpis).toMatchObject({
      views: 40, addToCarts: 10, orders: 1, netRevenueMinor: 159746, averageOrderMinor: 159746,
      viewToCartRate: 0.25, ordersPerCart: 0.1,
    });
    expect(r.kpis.discountRate).toBeCloseTo(17749 / 177495);
    expect(r.kpis.refundRate).toBe(0);
    expect(r.perBundle).toEqual([
      { bundleId: "b1", name: "FBT", views: 40, addToCarts: 10, addRate: 0.25, orders: 1, netRevenueMinor: 159746, discountRate: 17749 / 177495, refundRate: 0 },
    ]);
  });

  test("a rate with nothing to divide by is null, never 0%", () => {
    const r = run([], {});
    expect(r.kpis).toMatchObject({ viewToCartRate: null, ordersPerCart: null, discountRate: null, refundRate: null, averageOrderMinor: null, orders: 0 });
    expect(percent(null)).toBe("—");
    expect(percent(0)).toBe("0.0%");
    expect(percent(0.25)).toBe("25.0%");
    expect(run([], { b1: { view: 0, add_to_cart: 0 } }).perBundle[0].addRate).toBeNull();
  });

  test("a bundle with storefront activity but no orders (and one with orders but no views) both appear", () => {
    const r = run([row({ bundleId: "b2", orderId: "o2" })], { b1: { view: 5, add_to_cart: 1 } });
    expect(r.perBundle.map((b) => [b.bundleId, b.views, b.orders])).toEqual([["b2", 0, 1], ["b1", 5, 0]]);
  });

  test("bundles sort by revenue, then views, then id; a deleted bundle is named as such", () => {
    const r = run([row({ bundleId: "gone", orderId: "o9", netMinor: 1 })], { b1: { view: 9, add_to_cart: 0 }, b2: { view: 9, add_to_cart: 0 } });
    expect(r.perBundle.map((b) => b.bundleId)).toEqual(["gone", "b1", "b2"]);
    expect(r.perBundle[0].name).toBe("Deleted bundle");
  });

  test("an order counts once per bundle even with several rows, and cancelled orders are not orders", () => {
    const r = run([row(), row({ orderId: "o1", bundleId: "b2" }), row({ orderId: "o2", cancelled: true, netMinor: 0 })]);
    expect(r.kpis.orders).toBe(1);
    expect(r.perBundle.find((b) => b.bundleId === "b1")!.orders).toBe(1);
  });

  test("refund rate is the refunded or cancelled share of net sold", () => {
    const r = run([row({ netMinor: 79873, unitsRefunded: 1 })]); // half of 159,746 refunded
    expect(r.kpis.refundRate).toBeCloseTo(0.5, 2);
    const cancelled = run([row({ cancelled: true, netMinor: 0 })]);
    expect(cancelled.kpis.refundRate).toBe(1);
  });
});

describe("daily series", () => {
  test("every UTC day in the period is present, quiet days are zero, and revenue lands on the order's day", () => {
    const r = run([row(), row({ orderId: "o2", orderedAt: new Date("2026-10-24T23:59:59Z"), netMinor: 100 }), row({ orderId: "o3", orderedAt: new Date("2026-10-21T01:00:00Z"), netMinor: 50 })]);
    expect(r.daily.map((d) => d.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(r.daily.find((d) => d.date === "2026-10-24")).toMatchObject({ netMinor: 159846, orders: 2 });
    expect(r.daily.find((d) => d.date === "2026-10-21")).toMatchObject({ netMinor: 50, orders: 1 });
    expect(r.daily.find((d) => d.date === "2026-10-22")).toMatchObject({ netMinor: 0, orders: 0 });
    // the chart's total is the KPI's total
    expect(r.daily.reduce((s, d) => s + d.netMinor, 0)).toBe(r.kpis.netRevenueMinor);
  });

  test("a cancelled order adds no revenue and no order to its day", () => {
    const r = run([row({ cancelled: true, netMinor: 0 })]);
    expect(r.daily.find((d) => d.date === "2026-10-24")).toMatchObject({ netMinor: 0, orders: 0 });
  });

  test("dayRange spans month ends and a single day", () => {
    expect(dayRange(new Date("2026-10-30T10:00:00Z"), new Date("2026-11-02T01:00:00Z"))).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(dayRange(NOW, NOW)).toEqual(["2026-10-25"]);
  });
});

describe("axis maximum", () => {
  test("is a round number at or above the data", () => {
    for (const [v, want] of [[0, 1], [1, 1], [3, 5], [159746, 200000], [250000, 250000], [250001, 500000], [900000, 1000000]] as const) {
      expect(niceMax(v)).toBe(want);
      expect(niceMax(v)).toBeGreaterThanOrEqual(v);
    }
  });
});

describe("event counts by bundle (database)", () => {
  let prisma: Awaited<ReturnType<typeof createTestPrisma>>;
  let repo: ReturnType<typeof createBundleRepo>;
  const input = (name: string) => ({ name, status: "active" as const, pricingKind: "percentage" as const, pricingValue: 1000,
    items: [1, 2].map((n) => ({ productId: `gid://shopify/Product/${n}`, variantId: `gid://shopify/ProductVariant/${n}`, quantity: 1 })) });
  beforeEach(async () => {
    prisma = await createTestPrisma();
    await resetTestDb(prisma);
    repo = createBundleRepo(prisma);
  });

  test("grouped per bundle and type, within the period, for this shop only", async () => {
    const a = await repo.create("a.myshopify.com", "USD", input("A"));
    const b = await repo.create("b.myshopify.com", "USD", input("B"));
    const ev = (shop: string, bundleId: string, type: string, key: string, daysAgo = 1) =>
      prisma.bundleEvent.create({ data: { shop, bundleId, type, dedupeKey: key, createdAt: new Date(Date.now() - daysAgo * 86_400_000) } });
    await ev("a.myshopify.com", a.id, "view", "k1");
    await ev("a.myshopify.com", a.id, "view", "k2");
    await ev("a.myshopify.com", a.id, "add_to_cart", "k3");
    await ev("a.myshopify.com", a.id, "view", "old", 40);
    await ev("b.myshopify.com", b.id, "view", "k4");
    const out = await repo.eventCountsByBundle("a.myshopify.com", new Date(Date.now() - 7 * 86_400_000));
    expect(out).toEqual({ [a.id]: { view: 2, add_to_cart: 1 } });
    expect(await repo.eventCountsByBundle("c.myshopify.com", new Date(0))).toEqual({});
  });
});
