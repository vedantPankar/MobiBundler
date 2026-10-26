import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { OrdersSection, type OrdersSectionProps } from "../app/bundles/OrdersSection";
import type { OrderListRow } from "../app/bundles/orderRows";

const row = (over: Partial<OrderListRow> = {}): OrderListRow => ({
  orderId: "gid://shopify/Order/8693648851130", label: "#1001", numericId: "8693648851130", orderedAt: "2026-10-24T17:20:46Z",
  source: "historical", state: "paid", estimate: false, estimateReason: null, bundles: [{ bundleId: "b1", name: "FBT", units: 2 }],
  unitsSold: 2, unitsRefunded: 0, grossMinor: 177495, discountMinor: 17749, netMinor: 159746, refundedMinor: 0, unmappedRefundMinor: 0, ...over,
});
const props = (over: Partial<OrdersSectionProps> = {}): OrdersSectionProps => ({
  rows: [row()], total: 1, page: 1, pageSize: 25, days: 30, filter: "all", currency: "USD",
  sync: { lastSyncedAt: "2026-10-25T10:00:00Z", error: null }, onChange: () => {}, ...over,
});
const html = (p: OrdersSectionProps) => renderToStaticMarkup(<OrdersSection {...p} />);

describe("orders page states", () => {
  test("never synced: says so and shows no table", () => {
    const h = html(props({ rows: [], total: 0, sync: { lastSyncedAt: null, error: null } }));
    expect(h).toContain("have not been synced yet");
    expect(h).not.toContain("<s-table");
  });

  test("order access failing with nothing synced: unavailable, not 'no orders'", () => {
    const h = html(props({ rows: [], total: 0, sync: { lastSyncedAt: null, error: "denied" } }));
    expect(h).toContain("Orders are unavailable");
    expect(h).not.toContain("no bundle orders");
  });

  test("synced and empty: an explicit message, with the filter named when one is active", () => {
    expect(html(props({ rows: [], total: 0 }))).toContain("there are no bundle orders in the last 30 days");
    expect(html(props({ rows: [], total: 0, filter: "refunded" }))).toContain("No orders match “With refunds”");
  });

  test("a failed sync after a good one still shows the stored orders", () => {
    expect(html(props({ sync: { lastSyncedAt: "2026-10-25T10:00:00Z", error: "later failure" } }))).toContain("#1001");
  });
});

describe("orders table", () => {
  test("shows the order, its deep link, the bundle, and the money columns", () => {
    const h = html(props());
    expect(h).toContain("#1001");
    expect(h).toContain("shopify:admin/orders/8693648851130");
    expect(h).toContain("FBT");
    expect(h).toContain("$1,774.95");
    expect(h).toContain("$177.49");
    expect(h).toContain("$1,597.46");
    expect(h).toContain("Historical");
    expect(h).toContain("Paid");
  });

  test("refunded, cancelled and estimate badges and the estimate's reason", () => {
    const h = html(props({
      rows: [
        row({ orderId: "o2", label: "#1002", state: "partly_refunded", refundedMinor: 7499 }),
        row({ orderId: "o3", label: "#1003", state: "cancelled", refundedMinor: 159746, netMinor: 0 }),
        row({ orderId: "o4", label: "#1004", estimate: true, estimateReason: "line X: replay discounts 7499 but Shopify recorded 0", source: "live" }),
      ],
      total: 3,
    }));
    expect(h).toContain("Partly refunded");
    expect(h).toContain("Cancelled");
    expect(h).toContain("Estimate");
    expect(h).toContain("replay discounts 7499 but Shopify recorded 0");
    expect(h).toContain("Live");
  });

  test("a refund that names no products is explained, not deducted silently", () => {
    expect(html(props({ rows: [row({ unmappedRefundMinor: 2500 })] }))).toContain("$25.00 refunded without naming products");
  });

  test("pagination text and disabled buttons at the ends", () => {
    const first = html(props({ total: 60, page: 1 }));
    expect(first).toContain("60 order(s) · page 1 of 3");
    expect(first).toMatch(/<button[^>]*disabled[^>]*>Previous/);
    expect(first).not.toMatch(/<button[^>]*disabled[^>]*>Next/);
    expect(html(props({ total: 60, page: 3 }))).toMatch(/<button[^>]*disabled[^>]*>Next/);
  });
});

import { RecentOrders } from "../app/bundles/OrdersSection";

describe("dashboard: recent orders", () => {
  const rp = { rows: [row()], total: 12, currency: "USD", sync: { lastSyncedAt: "2026-10-25T10:00:00Z", error: null } };
  const rhtml = (p: Parameters<typeof RecentOrders>[0]) => renderToStaticMarkup(<RecentOrders {...p} />);

  test("shows the newest orders with a link to the full list", () => {
    const h = rhtml(rp);
    expect(h).toContain("Recent bundle orders");
    expect(h).toContain("#1001");
    expect(h).toContain('href="/app/orders"');
    expect(h).toContain("View all 12 order(s)");
    expect(h).not.toContain("<select");
    expect(h).not.toContain("Previous");
  });

  test("synced with none: says so", () => {
    expect(rhtml({ ...rp, rows: [], total: 0 })).toContain("no bundle orders yet");
  });

  test("not synced or unavailable: renders nothing (the revenue section above already explains it)", () => {
    expect(rhtml({ ...rp, sync: { lastSyncedAt: null, error: null } })).toBe("");
    expect(rhtml({ ...rp, sync: { lastSyncedAt: null, error: "denied" } })).toBe("");
  });
});
