import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { RevenueSection, type RevenueSectionProps } from "../app/bundles/RevenueSection";
import { BundleRevenuePanel } from "../app/bundles/BundleRevenuePanel";
import { shouldSyncRevenue, splitByCurrency, summarizeRevenue, type RevenueRow } from "../app/bundles/revenueSummary";

const row = (over: Partial<RevenueRow & { currencyCode: string }> = {}) => ({
  orderId: "o1", bundleId: "b1", source: "live", cancelled: false, reconciled: true, currencyCode: "USD",
  unitsSold: 2, unitsRefunded: 0, soldGrossMinor: 177495, soldDiscountMinor: 17749, netMinor: 159746, ...over,
});
const props = (over: Partial<RevenueSectionProps> = {}, rows = [row()]): RevenueSectionProps => {
  const { total, byBundle } = summarizeRevenue(rows);
  return {
    days: 30, currency: "USD", revenue: total, byBundle: byBundle.map((b) => ({ ...b, name: "FBT" })),
    unmapped: { minor: 0, orders: 0 }, otherCurrencyOrders: 0,
    sync: { lastSyncedAt: "2026-10-25T10:00:00Z", error: null, errorCode: null },
    onPeriodChange: () => {}, syncControl: <button>Sync orders now</button>, ...over,
  };
};
const html = (p: RevenueSectionProps) => renderToStaticMarkup(<RevenueSection {...p} />);

describe("dashboard revenue states", () => {
  test("never synced and no error: says so, prints no money", () => {
    const h = html(props({ sync: { lastSyncedAt: null, error: null, errorCode: null } }, []));
    expect(h).toContain("has not been synced yet");
    expect(h).not.toContain("$0.00");
    expect(h).not.toContain("Net bundle revenue");
  });

  test("order access not approved: critical approval banner, revenue unavailable, no zeros", () => {
    const h = html(props({ sync: { lastSyncedAt: null, error: "Shopify has not approved this app to read orders yet.", errorCode: "ACCESS_NOT_APPROVED" } }, []));
    expect(h).toContain("Shopify has not approved order access for this app");
    expect(h).toContain('tone="critical"');
    expect(h).toContain("Revenue is unavailable");
    expect(h).toContain("it is simply unavailable");
    expect(h).not.toContain("$0.00");
  });

  test("synced with no bundle orders: an explicit zero", () => {
    const h = html(props({}, []));
    expect(h).toContain("no bundle orders in this period");
    expect(h).toContain("$0.00");
  });

  test("synced with orders: totals, per-bundle row, definitions and sync time", () => {
    const h = html(props());
    expect(h).toContain("$1,597.46");
    expect(h).toContain("Average bundle order");
    expect(h).toContain("FBT");
    expect(h).toContain("excluding tax and shipping");
    expect(h).toContain("1 tracked live, 0 historical");
  });

  test("a failed sync after a good one keeps the numbers and warns", () => {
    const h = html(props({ sync: { lastSyncedAt: "2026-10-25T10:00:00Z", error: "Order sync failed. It will retry automatically.", errorCode: "FAILED" } }));
    expect(h).toContain("The latest revenue sync failed");
    expect(h).toContain("Showing data from the last successful sync");
    expect(h).toContain("$1,597.46");
  });

  test("caveats: estimates, historical orders, other currencies and untied refunds are disclosed", () => {
    const h = html(props({ otherCurrencyOrders: 2, unmapped: { minor: 2500, orders: 1 } }, [row({ reconciled: false, source: "backfill" })]));
    expect(h).toContain("1 order(s) could not be matched");
    expect(h).toContain("0 tracked live, 1 historical");
    expect(h).toContain("2 order(s) in another currency");
    expect(h).toContain("$25.00 was refunded on 1 order(s) without naming products");
  });

  test("refunds and cancellations are shown as a deduction", () => {
    const h = html(props({}, [row({ netMinor: 80000, unitsRefunded: 1 }), row({ orderId: "o2", cancelled: true, netMinor: 0 })]));
    expect(h).toContain("Refunds and cancellations: -");
    expect(h).toContain("1 orders cancelled");
  });
});

describe("dashboard data logic", () => {
  test("money is never summed across currencies; the other orders are counted", () => {
    const rows = [row(), row({ orderId: "o2", currencyCode: "EUR" }), row({ orderId: "o3", currencyCode: "EUR" }), row({ orderId: "o2", bundleId: "b2", currencyCode: "EUR" })];
    const s = splitByCurrency(rows, "USD");
    expect(s.rows).toHaveLength(1);
    expect(s.otherCurrencyOrders).toBe(2);
  });

  test("order refresh is throttled by the last success OR failure", () => {
    const now = new Date("2026-10-25T12:00:00Z");
    const ago = (m: number) => new Date(now.getTime() - m * 60_000);
    expect(shouldSyncRevenue(null, now)).toBe(true);
    expect(shouldSyncRevenue({ lastSyncedAt: null, lastErrorAt: null }, now)).toBe(true);
    expect(shouldSyncRevenue({ lastSyncedAt: ago(1), lastErrorAt: null }, now)).toBe(false);
    expect(shouldSyncRevenue({ lastSyncedAt: null, lastErrorAt: ago(1) }, now)).toBe(false); // no retry on every page view
    expect(shouldSyncRevenue({ lastSyncedAt: ago(30), lastErrorAt: ago(1) }, now)).toBe(false);
    expect(shouldSyncRevenue({ lastSyncedAt: ago(30), lastErrorAt: ago(20) }, now)).toBe(true);
  });
});

describe("per-bundle revenue panel", () => {
  const { total } = summarizeRevenue([row()]);
  const none = summarizeRevenue([]).total;
  const panel = (totals: typeof total, sync: { lastSyncedAt: string | null; error: string | null }) =>
    renderToStaticMarkup(<BundleRevenuePanel days={30} currency="USD" totals={totals} sync={sync} />);

  test("unsynced and unavailable show no money; a synced zero says zero; data shows figures", () => {
    expect(panel(none, { lastSyncedAt: null, error: null })).toContain("has not been synced yet");
    const unavailable = panel(none, { lastSyncedAt: null, error: "denied" });
    expect(unavailable).toContain("Revenue is unavailable");
    expect(unavailable).not.toContain("$0.00");
    expect(panel(none, { lastSyncedAt: "2026-10-25T10:00:00Z", error: null })).toContain("$0.00 revenue");
    expect(panel(total, { lastSyncedAt: "2026-10-25T10:00:00Z", error: null })).toContain("$1,597.46");
  });
});
