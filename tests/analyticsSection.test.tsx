import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AnalyticsSection, RevenueBars, type AnalyticsSectionProps } from "../app/bundles/AnalyticsSection";
import { buildAnalytics, type AnalyticsRow } from "../app/bundles/analytics";

const NOW = new Date("2026-10-25T12:00:00Z");
const row = (over: Partial<AnalyticsRow> = {}): AnalyticsRow => ({
  orderId: "o1", bundleId: "b1", source: "live", cancelled: false, reconciled: true, unitsSold: 2, unitsRefunded: 0,
  soldGrossMinor: 177495, soldDiscountMinor: 17749, netMinor: 159746, orderedAt: new Date("2026-10-24T17:20:46Z"), ...over,
});
const build = (rows: AnalyticsRow[], events = {}) =>
  buildAnalytics({ rows, events, since: new Date("2026-10-19T12:00:00Z"), now: NOW, names: new Map([["b1", "FBT"]]) });
const props = (over: Partial<AnalyticsSectionProps> = {}): AnalyticsSectionProps => ({
  days: 7, currency: "USD", result: build([row()], { b1: { view: 40, add_to_cart: 10 } }), revenueState: "data",
  sync: { error: null, errorCode: null }, onPeriodChange: () => {}, ...over,
});
const html = (p: AnalyticsSectionProps) => renderToStaticMarkup(<AnalyticsSection {...p} />);

describe("analytics page", () => {
  test("with data: tiles, funnel row, chart and the definitions", () => {
    const h = html(props());
    for (const t of ["Bundle views", "Add to cart", "View to cart rate", "25.0%", "$1,597.46", "Net revenue by day"]) expect(h).toContain(t);
    expect(h).toContain("FBT");
    expect(h).toContain("Discount rate");
    expect(h).toContain("not shown as a conversion rate");
    expect(h).toContain("Days are UTC");
  });

  test("order access failing: revenue is 'unavailable' (not $0.00) while storefront counts still show", () => {
    const h = html(props({ revenueState: "unavailable", sync: { error: "Shopify has not approved this app to read orders yet.", errorCode: "ACCESS_NOT_APPROVED" } }));
    expect(h).toContain("Revenue figures are unavailable");
    expect(h).toContain('tone="critical"');
    expect(h).toContain("Unavailable until order data has synced");
    expect(h).not.toContain("$0.00");
    expect(h).toContain("40"); // views
    expect(h).toContain("25.0%"); // cart rate does not depend on orders
  });

  test("never synced: an instruction, not a zero", () => {
    const h = html(props({ revenueState: "unsynced" }));
    expect(h).toContain("Sync orders now");
    expect(h).not.toContain("$0.00");
  });

  test("synced with no revenue: a real zero and no empty chart", () => {
    const h = html(props({ revenueState: "empty", result: build([], {}) }));
    expect(h).toContain("No bundle revenue in the last 7 days");
    expect(h).not.toContain("mb-chart"); // icons are svg too, so look for the chart itself
    expect(h).toContain("No bundle activity in this period yet");
  });
});

describe("revenue chart", () => {
  const daily = build([row(), row({ orderId: "o2", orderedAt: new Date("2026-10-22T08:00:00Z"), netMinor: 50000 })]).daily;
  const html2 = renderToStaticMarkup(<RevenueBars daily={daily} currency="USD" />);

  test("one column per day, bars only where there is revenue, rounded data ends anchored on the baseline", () => {
    expect((html2.match(/class="mb-hit"/g) ?? []).length).toBe(daily.length);
    expect((html2.match(/class="mb-bar"/g) ?? []).length).toBe(2);
    expect(html2).toMatch(/<path class="mb-bar" d="M[^"]*Q[^"]*Z"/);
  });

  test("every column is reachable by keyboard and described to screen readers", () => {
    expect(html2).toContain('tabindex="0"');
    expect(html2).toContain('role="img"');
    expect(html2).toMatch(/aria-label="Oct 24: \$1,597\.46, 1 order\(s\)"/);
  });

  test("the best day is directly labelled once; the readout starts on it", () => {
    expect((html2.match(/class="mb-peak"/g) ?? []).length).toBe(1);
    expect(html2).toContain("Best day: Oct 24 · $1,597.46");
  });

  test("a table view carries the same numbers, and the chart is themed for light and dark", () => {
    expect(html2).toContain("View as table");
    expect(html2).toContain("<td>2026-10-24</td><td>1</td><td>$1,597.46</td>");
    expect(html2).toContain("prefers-color-scheme:dark");
    expect(html2).toContain('[data-theme="dark"]');
  });

  test("axis: round tick values, a recessive grid, and a baseline", () => {
    expect(html2).toContain(">$0.00<"); // baseline label
    expect(html2).toContain(">$2,000.00<"); // top tick: the data max rounded up to 200000 minor units
    expect(html2).toContain("var(--grid)");
    expect(html2).toContain("var(--axis)");
  });

  test("the style block reaches the browser unescaped, so the dark-mode selectors work", () => {
    expect(html2).not.toContain("&quot;");
    expect(html2).toContain('[data-theme="light"]');
  });
});

import { RevenueLine } from "../app/bundles/AnalyticsSection";
describe("dashboard revenue line", () => {
  const daily = [
    { date: "2026-10-23", netMinor: 0, orders: 0 },
    { date: "2026-10-24", netMinor: 159746, orders: 1 },
  ];
  const h = renderToStaticMarkup(<RevenueLine daily={daily} currency="USD" />);
  test("one point per day, a line, an area, and a table view", () => {
    expect((h.match(/class="mb-dot"/g) ?? []).length).toBe(2);
    expect(h).toContain('class="mb-line"');
    expect(h).toContain('class="mb-area"');
    expect(h).toContain("View as table");
    expect(h).toMatch(/aria-label="Oct 24: \$1,597\.46, 1 order\(s\)"/);
    expect(h).not.toContain("&quot;");
  });
});
