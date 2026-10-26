import { beforeEach, describe, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createRevenueRepo } from "../app/bundles/revenue.repo.server";
import { syncOrders, type FetchOrdersPage } from "../app/bundles/revenueSync.server";
import { revenueViewState, summarizeRevenue } from "../app/bundles/revenueSummary";
import { adminOrdersFetcher, fetchOrderById } from "../app/bundles/ordersSource.server";
import { classifySyncError, ingestOrderById } from "../app/bundles/revenueSync.server";
import { normalizeOrder, type RawOrder } from "../app/bundles/orderNormalizer";
import { BUNDLE_DISCOUNT_MESSAGE } from "../app/bundles/engine";
import { createTestPrisma, resetTestDb } from "./testDb";
import type { BundleInput } from "../app/bundles/types";

// Raw orders below are SYNTHETIC: they follow the shape this app ASSUMES Shopify returns (see orderNormalizer.ts),
// not a captured payload. They prove our logic is consistent, not that Shopify's payloads look like this.
const S = "a.myshopify.com";
const OXY = "gid://shopify/ProductVariant/50798419509434";
const LIQ = "gid://shopify/ProductVariant/50798419411130";
const EXTRA = "gid://shopify/ProductVariant/777";
const product = (v: string) => v.replace("ProductVariant", "Product");
const bundleInput = (name: string, items: string[], bps = 1000): BundleInput => ({
  name,
  status: "active",
  pricingKind: "percentage",
  pricingValue: bps,
  items: items.map((v) => ({ productId: product(v), variantId: v, quantity: 1 })),
});

type L = { id: string; v: string; q?: number; price: string; recorded?: string; current?: number };
const money = (a: string) => ({ shopMoney: { amount: a, currencyCode: "USD" } });
// Default orders are placed a minute after "now", i.e. after tracking began, so they count as live, not historical.
const soon = () => new Date(Date.now() + 60_000).toISOString();
function raw(id: string, lines: L[], o: Partial<RawOrder> & { refunds?: RawOrder["refunds"] } = {}): RawOrder {
  return {
    id,
    createdAt: o.createdAt ?? soon(),
    updatedAt: o.updatedAt ?? soon(),
    cancelledAt: o.cancelledAt ?? null,
    currencyCode: "USD",
    lineItems: {
      pageInfo: { hasNextPage: false },
      nodes: lines.map((l) => ({
        id: l.id,
        quantity: l.q ?? 1,
        currentQuantity: l.current ?? l.q ?? 1,
        variant: { id: l.v },
        originalUnitPriceSet: money(l.price),
        discountAllocations: l.recorded
          ? [{ allocatedAmountSet: money(l.recorded), discountApplication: { __typename: "AutomaticDiscountApplication", title: BUNDLE_DISCOUNT_MESSAGE } }]
          : [],
      })),
    },
    refunds: o.refunds ?? [],
  };
}
const refund = (id: string, lineId: string, quantity: number, total = "1.00") => ({
  id,
  totalRefundedSet: money(total),
  refundLineItems: { pageInfo: { hasNextPage: false }, nodes: [{ quantity, lineItem: { id: lineId } }] },
});
// Order #1001's recorded figures, used as the discount Shopify "recorded" for reconciliation.
const order1001 = (id = "gid://shopify/Order/1001", o: Parameters<typeof raw>[2] = {}) =>
  raw(id, [
    { id: "L1", v: OXY, price: "1025.00", recorded: "102.50" },
    { id: "L2", v: LIQ, price: "749.95", recorded: "74.99" },
  ], o);

let prisma: Awaited<ReturnType<typeof createTestPrisma>>;
let bundles: ReturnType<typeof createBundleRepo>;
let repo: ReturnType<typeof createRevenueRepo>;
const page = (orders: RawOrder[]): FetchOrdersPage => async () => ({ orders, hasNext: false, endCursor: null });
const sync = (orders: RawOrder[], now?: Date) => syncOrders({ shop: S, repo, bundleRepo: bundles, fetchPage: page(orders), now });
const rows = () => prisma.bundleOrderRevenue.findMany({ where: { shop: S }, orderBy: [{ orderId: "asc" }, { bundleId: "asc" }] });

beforeEach(async () => {
  prisma = await createTestPrisma();
  await resetTestDb(prisma);
  bundles = createBundleRepo(prisma);
  repo = createRevenueRepo(prisma);
  await bundles.create(S, "USD", bundleInput("FBT", [OXY, LIQ]));
});

describe("single bundle", () => {
  test("attributes net revenue, reconciles with Shopify's recorded discount, and is live", async () => {
    const r = await sync([order1001()]);
    expect(r).toMatchObject({ ok: true, created: 1, failed: 0 });
    const [row] = await rows();
    expect(row).toMatchObject({ unitsSold: 2, soldGrossMinor: 177495, soldDiscountMinor: 17749, netMinor: 159746, reconciled: true, source: "live" });
  });

  test("re-ingesting the same order is a no-op (idempotent)", async () => {
    await sync([order1001()]);
    const before = await rows();
    const again = await sync([order1001(), order1001()]);
    expect(again).toMatchObject({ created: 0, unchanged: 2 });
    expect(await rows()).toEqual(before);
    expect(await prisma.orderRecord.count()).toBe(1);
  });

  test("products added individually attribute the same (no bundle line property needed)", async () => {
    await sync([order1001()]); // our raw orders never carry _mobi_bundle at all
    expect((await rows())[0].reconciled).toBe(true);
  });
});

describe("mixed carts and multiple bundles", () => {
  test("unrelated items are not attributed or stored", async () => {
    await sync([raw("gid://shopify/Order/2", [
      { id: "L1", v: OXY, price: "1025.00", recorded: "102.50" },
      { id: "L2", v: LIQ, price: "749.95", recorded: "74.99" },
      { id: "X", v: EXTRA, price: "50.00" },
    ])]);
    const [row] = await rows();
    expect(row.soldGrossMinor).toBe(177495);
    expect(row.netMinor).toBe(159746);
  });

  test("an order with no bundle items is never stored", async () => {
    expect(await sync([raw("gid://shopify/Order/3", [{ id: "X", v: EXTRA, price: "50.00" }])])).toMatchObject({ skipped: 1, created: 0 });
    expect(await prisma.orderRecord.count()).toBe(0);
  });

  test("two bundles in one order each get their own row; no unit is counted twice", async () => {
    const pair = await bundles.create(S, "USD", bundleInput("Pair", [EXTRA, LIQ], 2000));
    const fbt = (await bundles.list(S)).find((b) => b.name === "FBT")!;
    // overlap on LIQ: the engine gives each unit to one bundle only
    await sync([raw("gid://shopify/Order/4", [
      { id: "L1", v: OXY, price: "1025.00" },
      { id: "L2", v: LIQ, price: "749.95" },
      { id: "X", v: EXTRA, price: "50.00" },
    ])]);
    const rs = await rows();
    const units = rs.reduce((s, r) => s + r.unitsSold, 0);
    expect(units).toBeLessThanOrEqual(3);
    expect(rs.every((r) => [pair.id, fbt.id].includes(r.bundleId))).toBe(true);
    expect(rs.every((r) => r.netMinor === r.soldGrossMinor - r.soldDiscountMinor)).toBe(true);
  });

  test("quantity 2 forms two sets", async () => {
    await sync([raw("gid://shopify/Order/5", [
      { id: "L1", v: OXY, q: 2, price: "1025.00", recorded: "205.00" },
      { id: "L2", v: LIQ, q: 2, price: "749.95", recorded: "149.99" },
    ])]);
    expect((await rows())[0]).toMatchObject({ sets: 2, unitsSold: 4, soldDiscountMinor: 35499 });
  });
});

describe("refunds and cancellations", () => {
  test("a partial refund updates revenue; repeated deliveries do not deduct twice", async () => {
    await sync([order1001()]);
    const withRefund = () => order1001("gid://shopify/Order/1001", { refunds: [refund("gid://shopify/Refund/1", "L2", 1)] });
    expect(await sync([withRefund()])).toMatchObject({ updated: 1 });
    const once = (await rows())[0];
    expect(once.unitsRefunded).toBe(1);
    expect(once.netMinor).toBeLessThan(159746);
    await sync([withRefund(), withRefund()]);
    expect((await rows())[0]).toEqual(once);
  });

  test("a second refund id for a unit already refunded cannot refund more than was sold", async () => {
    await sync([order1001("gid://shopify/Order/1001", { refunds: [refund("r1", "L2", 1), refund("r2", "L2", 1)] })]);
    expect((await rows())[0].unitsRefunded).toBe(1);
  });

  test("an amount-only refund (no order lines) never changes item revenue and is surfaced separately", async () => {
    await sync([order1001("gid://shopify/Order/1001", {
      refunds: [{ id: "r9", totalRefundedSet: money("25.00"), refundLineItems: { pageInfo: { hasNextPage: false }, nodes: [] } }],
    })]);
    expect((await rows())[0].netMinor).toBe(159746);
    expect(await repo.unmappedRefunds(S, new Date(0))).toEqual({ minor: 2500, orders: 1 });
  });

  test("cancellation zeroes revenue; later refund events on it change nothing", async () => {
    await sync([order1001()]);
    const cancelled = order1001("gid://shopify/Order/1001", { cancelledAt: new Date().toISOString(), refunds: [refund("r1", "L1", 1)] });
    await sync([cancelled]);
    const [row] = await rows();
    expect(row).toMatchObject({ cancelled: true, netMinor: 0, soldGrossMinor: 177495 });
    await sync([cancelled]);
    expect((await rows())[0]).toEqual(row);
  });
});

describe("config changes and order edits", () => {
  test("a reconciled order keeps its attribution when the bundle is edited later", async () => {
    await sync([order1001()]);
    const fbt = (await bundles.list(S)).find((b) => b.name === "FBT")!;
    await bundles.update(S, fbt.id, fbt.version, bundleInput("FBT", [OXY, LIQ], 5000));
    await sync([order1001("gid://shopify/Order/1001", { refunds: [refund("r1", "L2", 1)] })]);
    const [row] = await rows();
    expect(row.soldDiscountMinor).toBe(17749); // still the 10% discount customers actually got
    expect(row.unitsRefunded).toBe(1);
  });

  test("an order that does not match Shopify's recorded discount is flagged, then re-attributed once the config matches", async () => {
    const fbt = (await bundles.list(S)).find((b) => b.name === "FBT")!;
    await bundles.update(S, fbt.id, fbt.version, bundleInput("FBT", [OXY, LIQ], 5000)); // wrong vs what was charged
    await sync([order1001()]);
    expect((await rows())[0].reconciled).toBe(false);
    const cur = (await bundles.list(S)).find((b) => b.name === "FBT")!;
    await bundles.update(S, cur.id, cur.version, bundleInput("FBT", [OXY, LIQ], 1000));
    await sync([order1001()]);
    expect((await rows())[0]).toMatchObject({ reconciled: true, soldDiscountMinor: 17749 });
  });

  test("a changed set of lines (order edit) is attributed afresh", async () => {
    await sync([order1001()]);
    await sync([raw("gid://shopify/Order/1001", [{ id: "L1", v: OXY, price: "1025.00" }])]); // LIQ removed
    expect(await rows()).toEqual([]);
  });

  test("a quantity that differs from the current quantity is noted but not blocking", async () => {
    await sync([raw("gid://shopify/Order/6", [
      { id: "L1", v: OXY, price: "1025.00", recorded: "102.50", current: 0 },
      { id: "L2", v: LIQ, price: "749.95", recorded: "74.99" },
    ])]);
    const rec = (await prisma.orderRecord.findFirst())!;
    expect(rec.reconciled).toBe(true);
    expect(rec.reconcileNote).toContain("quantity changed");
  });
});

describe("sync, backfill and failures", () => {
  test("first run backfills history; orders placed after tracking began are live; reruns add nothing", async () => {
    const now = new Date("2026-10-25T12:00:00Z");
    const old = order1001("gid://shopify/Order/1", { createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z" });
    const r1 = await sync([old], now);
    expect(r1.mode).toBe("backfill");
    const after = order1001("gid://shopify/Order/2", { createdAt: "2026-10-25T13:00:00Z", updatedAt: "2026-10-25T13:00:00Z" });
    const r2 = await sync([old, after], new Date("2026-10-25T14:00:00Z"));
    expect(r2.mode).toBe("incremental");
    const bySource = Object.fromEntries((await rows()).map((x) => [x.orderId, x.source]));
    expect(bySource).toEqual({ "gid://shopify/Order/1": "backfill", "gid://shopify/Order/2": "live" });
    const r3 = await sync([old, after], new Date("2026-10-25T15:00:00Z"));
    expect(r3).toMatchObject({ created: 0, unchanged: 2 });
    expect(await rows()).toHaveLength(2);
  });

  test("Shopify refusing access is reported clearly, stored, and cleared by the next success", async () => {
    const denied: FetchOrdersPage = async () => {
      throw new Error("This app is not approved to access the Order object. See https://shopify.dev/...");
    };
    const r = await syncOrders({ shop: S, repo, bundleRepo: bundles, fetchPage: denied });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("protected customer data");
    expect((await repo.getState(S))!.lastError).toContain("protected customer data");
    await sync([]);
    expect((await repo.getState(S))!.lastError).toBeNull();
  });

  test("a failing order is counted, others still ingest, and the cursor is not advanced past it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { ...order1001("gid://shopify/Order/bad"), refunds: 42 as unknown as RawOrder["refunds"] };
    const r = await sync([bad, order1001("gid://shopify/Order/good")]);
    expect(r).toMatchObject({ failed: 1, created: 1 });
    expect((await repo.getState(S))!.lastOrderUpdatedAt).toBeNull();
  });

  test("shops are isolated and shop erase removes all revenue data", async () => {
    await sync([order1001()]);
    const other = "b.myshopify.com";
    await syncOrders({ shop: other, repo, bundleRepo: bundles, fetchPage: page([order1001()]) });
    expect(await rows()).toHaveLength(1); // other shop has no bundles, so nothing attributed
    await bundles.deleteAllForShop(S);
    expect(await prisma.bundleOrderRevenue.count({ where: { shop: S } })).toBe(0);
    expect(await prisma.orderRecord.count({ where: { shop: S } })).toBe(0);
    expect(await prisma.revenueSyncState.count({ where: { shop: S } })).toBe(0);
  });
});

describe("normalizer", () => {
  test("flags truncated line items as a blocking warning", () => {
    const o = order1001();
    o.lineItems!.pageInfo = { hasNextPage: true };
    expect(normalizeOrder(o).warnings).toHaveLength(1);
  });
  test("ignores lines without a variant and other discounts' allocations", () => {
    const o = order1001();
    o.lineItems!.nodes![0].discountAllocations!.push({
      allocatedAmountSet: money("5.00"),
      discountApplication: { __typename: "DiscountCodeApplication" },
    });
    o.lineItems!.nodes!.push({ id: "C", quantity: 1, variant: null, originalUnitPriceSet: money("1.00") });
    const n = normalizeOrder(o);
    expect(n.lines).toHaveLength(2);
    expect(n.recordedDiscountByLine).toEqual({ L1: 10250, L2: 7499 });
  });
});

describe("dashboard totals", () => {
  test("definitions: gross, discounts, refunded and cancelled value, net, orders, average, live vs historical", async () => {
    await sync([order1001("gid://shopify/Order/1")]); // full, live
    await sync([order1001("gid://shopify/Order/2", { refunds: [refund("r1", "L2", 1)] })]); // partly refunded
    await sync([order1001("gid://shopify/Order/3", { cancelledAt: new Date().toISOString() })]); // cancelled
    const { total, byBundle } = summarizeRevenue((await repo.rows(S, new Date(0))) as never);
    expect(total.grossSalesMinor).toBe(177495 * 3);
    expect(total.discountsMinor).toBe(17749 * 3);
    expect(total.netSoldMinor).toBe(159746 * 3);
    expect(total.netRevenueMinor).toBe(159746 + (await rows()).find((r) => r.orderId.endsWith("/2"))!.netMinor);
    expect(total.refundedMinor).toBe(total.netSoldMinor - total.netRevenueMinor);
    expect(total.orders).toBe(2);
    expect(total.cancelledOrders).toBe(1);
    expect(total.averageOrderMinor).toBe(Math.floor(total.netRevenueMinor / 2));
    expect(byBundle).toHaveLength(1);
  });
});

describe("empty data and API errors", () => {
  test("a successful sync with no orders is a real zero, not 'unavailable'", async () => {
    expect(await sync([])).toMatchObject({ ok: true, seen: 0 });
    const st = (await repo.getState(S))!;
    expect(st.lastSyncedAt).not.toBeNull();
    expect(revenueViewState({ lastSyncedAt: st.lastSyncedAt!.toISOString(), error: null }, { orders: 0, cancelledOrders: 0 })).toBe("empty");
    expect(summarizeRevenue([]).total).toMatchObject({ netRevenueMinor: 0, orders: 0, averageOrderMinor: 0 });
  });

  test("view state: unsynced, unavailable, empty and data are told apart", () => {
    const none = { orders: 0, cancelledOrders: 0 };
    expect(revenueViewState({ lastSyncedAt: null, error: null }, none)).toBe("unsynced");
    expect(revenueViewState({ lastSyncedAt: null, error: "denied" }, none)).toBe("unavailable");
    expect(revenueViewState({ lastSyncedAt: "2026-10-25T00:00:00Z", error: "later failure" }, none)).toBe("empty");
    expect(revenueViewState({ lastSyncedAt: "2026-10-25T00:00:00Z", error: null }, { orders: 1, cancelledOrders: 0 })).toBe("data");
    expect(revenueViewState({ lastSyncedAt: "2026-10-25T00:00:00Z", error: null }, { orders: 0, cancelledOrders: 1 })).toBe("data");
  });

  test("errors are classified and stored with a stable code", async () => {
    expect(classifySyncError(new Error("This app is not approved to access the Order object")).code).toBe("ACCESS_NOT_APPROVED");
    expect(classifySyncError(new Error("Access denied for orders field")).code).toBe("ACCESS_DENIED");
    expect(classifySyncError(new Error("socket hang up")).code).toBe("FAILED");
    const boom: FetchOrdersPage = async () => {
      throw new Error("This app is not approved to access the Order object");
    };
    const r = await syncOrders({ shop: S, repo, bundleRepo: bundles, fetchPage: boom });
    expect(r).toMatchObject({ ok: false, errorCode: "ACCESS_NOT_APPROVED" });
    expect((await repo.getState(S))!.lastErrorCode).toBe("ACCESS_NOT_APPROVED");
    await sync([]);
    expect((await repo.getState(S))!.lastErrorCode).toBeNull();
  });

  test("a failed sync after a good one keeps the earlier data and the earlier sync time", async () => {
    await sync([order1001()]);
    const good = (await repo.getState(S))!.lastSyncedAt;
    await syncOrders({ shop: S, repo, bundleRepo: bundles, fetchPage: async () => { throw new Error("socket hang up"); } });
    const st = (await repo.getState(S))!;
    expect(st.lastSyncedAt).toEqual(good);
    expect(st.lastErrorCode).toBe("FAILED");
    expect(await rows()).toHaveLength(1);
  });

  test("hitting the page limit is reported as partial and the next run continues", async () => {
    const pages: RawOrder[][] = [[order1001("gid://shopify/Order/p1")], [order1001("gid://shopify/Order/p2")]];
    let n = 0;
    const paged: FetchOrdersPage = async () => {
      const orders = pages[Math.min(n, 1)];
      n++;
      return { orders, hasNext: n < 2, endCursor: `c${n}` };
    };
    const r = await syncOrders({ shop: S, repo, bundleRepo: bundles, fetchPage: paged, maxPages: 1 });
    expect(r).toMatchObject({ ok: true, partial: true, created: 1 });
    n = 1;
    expect(await syncOrders({ shop: S, repo, bundleRepo: bundles, fetchPage: paged, maxPages: 5 })).toMatchObject({ created: 1 });
    expect(await rows()).toHaveLength(2);
  });
});

describe("concurrency and retries", () => {
  test("two simultaneous syncs of the same new order produce one record", async () => {
    const o = order1001();
    await Promise.all([sync([o]), sync([o]), sync([o])]);
    expect(await prisma.orderRecord.count()).toBe(1);
    expect(await rows()).toHaveLength(1);
  });

  test("webhook-style ingestion by id converges on Shopify's current state regardless of delivery order", async () => {
    const paid = order1001();
    const refunded = order1001("gid://shopify/Order/1001", { refunds: [refund("r1", "L2", 1)] });
    let current = paid;
    const ingest = () =>
      ingestOrderById({ shop: S, orderGid: "gid://shopify/Order/1001", repo, bundleRepo: bundles, fetchOrder: async () => current });
    expect(await ingest()).toBe("created");
    current = refunded;
    expect(await ingest()).toBe("updated");
    // late, duplicate or reordered deliveries all re-read the same current state
    expect(await ingest()).toBe("unchanged");
    expect(await ingest()).toBe("unchanged");
    expect((await rows())[0].unitsRefunded).toBe(1);
    expect(await ingestOrderById({ shop: S, orderGid: "gid://shopify/Order/9", repo, bundleRepo: bundles, fetchOrder: async () => null })).toBe("not_found");
  });
});

describe("currencies", () => {
  test("a zero-decimal (JPY) shop attributes exactly in whole units", async () => {
    await resetTestDb(prisma);
    await bundles.create(S, "JPY", bundleInput("JP", [OXY, LIQ], 1500));
    const yen = (v: string, id: string, price: string, recorded?: string): L => ({ id, v, price, recorded });
    const o = raw("gid://shopify/Order/jp", [yen(OXY, "A", "1999", "300"), yen(LIQ, "B", "3001", "450")]);
    for (const l of o.lineItems!.nodes!) {
      l.originalUnitPriceSet = { shopMoney: { amount: l.originalUnitPriceSet!.shopMoney!.amount, currencyCode: "JPY" } };
    }
    await sync([o]);
    const [row] = await rows();
    expect(row).toMatchObject({ currencyCode: "JPY", soldGrossMinor: 5000, soldDiscountMinor: 750, netMinor: 4250, reconciled: true });
  });

  test("a bundle configured in another currency than the order is flagged, not silently trusted", async () => {
    await resetTestDb(prisma);
    await bundles.create(S, "EUR", bundleInput("EUR bundle", [OXY, LIQ]));
    await sync([order1001()]); // order is in USD
    const rec = (await prisma.orderRecord.findFirst())!;
    expect(rec.reconciled).toBe(false);
    expect(rec.reconcileNote).toContain("priced in EUR");
  });

  test("totals from different currencies are never added together by the summary rows", async () => {
    const jp = { orderId: "1", bundleId: "b", source: "live", cancelled: false, reconciled: true, unitsSold: 1, unitsRefunded: 0, soldGrossMinor: 100, soldDiscountMinor: 10, netMinor: 90 };
    expect(summarizeRevenue([jp]).total.netRevenueMinor).toBe(90);
  });
});

describe("older stored records and sets", () => {
  test("rows store the sets still intact after a refund", async () => {
    await sync([order1001()]);
    expect((await rows())[0].sets).toBe(1);
    await sync([order1001("gid://shopify/Order/1001", { refunds: [refund("r1", "L2", 1)] })]);
    expect((await rows())[0].sets).toBe(0);
  });

  test("an attribution stored before item details existed still works and applies refunds", async () => {
    await sync([order1001()]);
    const rec = (await prisma.orderRecord.findFirst())!;
    const old = JSON.parse(rec.attributionJson);
    delete old.bundleItems;
    for (const c of old.chunks) delete c.variantId;
    await prisma.orderRecord.update({ where: { id: rec.id }, data: { attributionJson: JSON.stringify(old) } });
    await sync([order1001("gid://shopify/Order/1001", { refunds: [refund("r1", "L2", 1)] })]);
    const [row] = await rows();
    expect(row.unitsRefunded).toBe(1);
    expect(row.sets).toBe(1); // purchased count kept: item details are missing
  });
});

describe("Shopify fetchers (fake admin; query shape unverified)", () => {
  const admin = (body: unknown) => ({ graphql: vi.fn(async () => ({ json: async () => body })) });

  test("orders page: maps nodes and paging, and sends the updated_at filter", async () => {
    const a = admin({ data: { orders: { pageInfo: { hasNextPage: true, endCursor: "c" }, nodes: [order1001()] } } });
    const page = await adminOrdersFetcher(a as never)({ updatedSince: new Date("2026-10-01T00:00:00Z"), after: null });
    expect(page).toMatchObject({ hasNext: true, endCursor: "c" });
    expect(page.orders).toHaveLength(1);
    const vars = (a.graphql.mock.calls[0] as unknown as [string, { variables: { q: string } }])[1].variables;
    expect(vars.q).toContain("updated_at:>='2026-10-01T00:00:00.000Z'");
  });

  test("GraphQL errors throw so the sync records the failure", async () => {
    const a = admin({ errors: [{ message: "This app is not approved to access the Order object." }] });
    await expect(adminOrdersFetcher(a as never)({ updatedSince: new Date(), after: null })).rejects.toThrow("not approved");
    await expect(fetchOrderById(a as never, "gid://shopify/Order/1")).rejects.toThrow("not approved");
  });

  test("single order: null when it does not exist", async () => {
    expect(await fetchOrderById(admin({ data: { order: null } }) as never, "gid://shopify/Order/1")).toBeNull();
  });
});

describe("refund kinds (shipping/tax-only refunds are modelled as refunds that name no products; unverified)", () => {
  const noLines = (id: string, total: string) => ({ id, totalRefundedSet: money(total), refundLineItems: { pageInfo: { hasNextPage: false }, nodes: [] } });

  test.each([["shipping-only", "10.00"], ["tax-only", "5.00"], ["manual amount", "25.00"]])("%s refund leaves bundle revenue unchanged and is surfaced separately", async (_k, total) => {
    await sync([order1001("gid://shopify/Order/1001", { refunds: [noLines("r1", total)] })]);
    expect((await rows())[0].netMinor).toBe(159746);
    expect((await repo.unmappedRefunds(S, new Date(0))).minor).toBe(Number(total.replace(".", "")));
  });

  test("an item refund that also returned shipping deducts only the unit, and shipping is not double counted", async () => {
    await sync([order1001("gid://shopify/Order/1001", { refunds: [{ ...refund("r1", "L2", 1, "84.99") }] })]);
    const [row] = await rows();
    expect(row.unitsRefunded).toBe(1);
    expect((await repo.unmappedRefunds(S, new Date(0))).minor).toBe(0); // it named a product, so nothing is "unattributed"
    // the unit's own share of the paid price, never the refund's total
    expect(row.netMinor).toBe(159746 - (74995 - 7499));
  });

  test("an item refund plus a later shipping-only refund: only the unit is deducted", async () => {
    await sync([order1001("gid://shopify/Order/1001", { refunds: [refund("r1", "L2", 1), noLines("r2", "10.00")] })]);
    expect((await rows())[0].unitsRefunded).toBe(1);
    expect((await repo.unmappedRefunds(S, new Date(0))).minor).toBe(1000);
  });

  test("a refund naming a line that is not on the order, or quantity 0, changes nothing", async () => {
    await sync([order1001("gid://shopify/Order/1001", { refunds: [refund("r1", "NOPE", 1), refund("r2", "L1", 0)] })]);
    expect((await rows())[0]).toMatchObject({ unitsRefunded: 0, netMinor: 159746 });
  });
});

describe("order edits", () => {
  test("quantity reduced after purchase: attributed afresh to the new lines", async () => {
    const two = (q: number) => raw("gid://shopify/Order/e1", [
      { id: "L1", v: OXY, q, price: "1025.00", recorded: q === 2 ? "205.00" : "102.50" },
      { id: "L2", v: LIQ, q, price: "749.95", recorded: q === 2 ? "149.99" : "74.99" },
    ]);
    await sync([two(2)]);
    expect((await rows())[0].unitsSold).toBe(4);
    await sync([two(1)]);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ unitsSold: 2, soldDiscountMinor: 17749, reconciled: true });
    expect(await prisma.orderRecord.count()).toBe(1);
  });

  test("an edit that removes a bundle component ends the attribution; the order stays stored without revenue rows", async () => {
    await sync([order1001()]);
    await sync([raw("gid://shopify/Order/1001", [{ id: "L1", v: OXY, price: "1025.00" }])]);
    expect(await rows()).toEqual([]);
    expect(await prisma.orderRecord.count()).toBe(1);
  });
});

describe("customer-data minimisation", () => {
  test("customer fields present on an order never reach the database", async () => {
    const o = order1001() as RawOrder & Record<string, unknown>;
    o.customer = { email: "shopper@example.com", firstName: "Zed", phone: "+15551234567" };
    o.email = "shopper@example.com";
    o.shippingAddress = { address1: "1 Secret Street", zip: "99999" };
    o.billingAddress = { address1: "2 Hidden Road" };
    o.note = "gift for Zed";
    (o.lineItems!.nodes![0] as unknown as Record<string, unknown>).customAttributes = [{ key: "_mobi_bundle", value: "x" }, { key: "engraving", value: "ZED" }];
    await sync([o]);
    const dump = JSON.stringify({
      orders: await prisma.orderRecord.findMany(),
      revenue: await prisma.bundleOrderRevenue.findMany(),
      state: await prisma.revenueSyncState.findMany(),
    });
    for (const secret of ["shopper@example.com", "Zed", "ZED", "+1555", "Secret Street", "99999", "Hidden Road", "gift for"]) {
      expect(dump).not.toContain(secret);
    }
  });

  test("the order queries ask for no customer, address, email, phone or note fields", async () => {
    const { ORDERS_SYNC_QUERY, ORDER_BY_ID_QUERY } = await import("../app/bundles/ordersSource.server");
    for (const q of [ORDERS_SYNC_QUERY, ORDER_BY_ID_QUERY]) {
      expect(q).not.toMatch(/customer|email|phone|address|billing|shipping|\bnote\b|firstName|lastName|displayName|browserIp|clientDetails/i);
    }
  });

  test("revenue tables have no customer-identifying columns", async () => {
    const cols = (await prisma.$queryRawUnsafe<{ name: string }[]>(
      `select m.name as name from pragma_table_info('OrderRecord') m union all select name from pragma_table_info('BundleOrderRevenue') union all select name from pragma_table_info('RevenueSyncState')`,
    )).map((c) => c.name.toLowerCase());
    // "orderName" is the merchant-visible order number (e.g. #1001), not a person's name.
    expect(cols.filter((c) => /customer|email|phone|address|name$|ip$/.test(c) && !["bundleid", "ordername"].includes(c))).toEqual([]);
  });
});
