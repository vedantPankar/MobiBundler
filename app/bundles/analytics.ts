// Pure: turns revenue rows and anonymous storefront counts into the numbers and series the Analytics page shows.
// Rates are fractions (0 to 1) or null when the denominator is zero, so a page never shows 0% for "no data".
import type { RevenueRow } from "./revenueSummary";

export interface AnalyticsRow extends RevenueRow {
  orderedAt: Date;
}
export type EventCounts = Record<string, { view: number; add_to_cart: number }>;

export interface BundleAnalytics {
  bundleId: string;
  name: string;
  views: number;
  addToCarts: number;
  /** add to carts / views */
  addRate: number | null;
  orders: number;
  netRevenueMinor: number;
  /** discounts / gross sales */
  discountRate: number | null;
  /** value of refunded or cancelled items / net sold */
  refundRate: number | null;
}

export interface DailyPoint {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  netMinor: number;
  orders: number;
}

export interface AnalyticsResult {
  kpis: {
    views: number;
    addToCarts: number;
    orders: number;
    netRevenueMinor: number;
    /** Bundle sales at list price, discounts given, and the value of refunded or cancelled items. */
    grossMinor: number;
    discountsMinor: number;
    refundedMinor: number;
    averageOrderMinor: number | null;
    /** add to carts / views */
    viewToCartRate: number | null;
    /** bundle orders / add to carts. Approximate: orders can come from items added outside the block. */
    ordersPerCart: number | null;
    discountRate: number | null;
    refundRate: number | null;
  };
  perBundle: BundleAnalytics[];
  daily: DailyPoint[];
}

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Every UTC date from `since` to `now`, inclusive, so quiet days show as zero instead of being skipped. */
export function dayRange(since: Date, now: Date): string[] {
  const out: string[] = [];
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let t = Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()); t <= end; t += 86_400_000) {
    out.push(dayKey(new Date(t)));
  }
  return out;
}

export function buildAnalytics(d: {
  rows: AnalyticsRow[];
  events: EventCounts;
  since: Date;
  now: Date;
  names: Map<string, string>;
}): AnalyticsResult {
  const ids = new Set<string>([...Object.keys(d.events), ...d.rows.map((r) => r.bundleId)]);
  const perBundle: BundleAnalytics[] = [...ids].map((bundleId) => {
    const rows = d.rows.filter((r) => r.bundleId === bundleId);
    const ev = d.events[bundleId] ?? { view: 0, add_to_cart: 0 };
    const gross = rows.reduce((s, r) => s + r.soldGrossMinor, 0);
    const disc = rows.reduce((s, r) => s + r.soldDiscountMinor, 0);
    const net = rows.reduce((s, r) => s + r.netMinor, 0);
    const netSold = gross - disc;
    return {
      bundleId,
      name: d.names.get(bundleId) ?? "Deleted bundle",
      views: ev.view,
      addToCarts: ev.add_to_cart,
      addRate: ratio(ev.add_to_cart, ev.view),
      orders: new Set(rows.filter((r) => !r.cancelled).map((r) => r.orderId)).size,
      netRevenueMinor: net,
      discountRate: ratio(disc, gross),
      refundRate: ratio(netSold - net, netSold),
    };
  });
  perBundle.sort((a, b) => b.netRevenueMinor - a.netRevenueMinor || b.views - a.views || (a.bundleId < b.bundleId ? -1 : 1));

  const gross = d.rows.reduce((s, r) => s + r.soldGrossMinor, 0);
  const disc = d.rows.reduce((s, r) => s + r.soldDiscountMinor, 0);
  const net = d.rows.reduce((s, r) => s + r.netMinor, 0);
  const orders = new Set(d.rows.filter((r) => !r.cancelled).map((r) => r.orderId)).size;
  const views = Object.values(d.events).reduce((s, e) => s + e.view, 0);
  const carts = Object.values(d.events).reduce((s, e) => s + e.add_to_cart, 0);

  const days = new Map(dayRange(d.since, d.now).map((k) => [k, { date: k, netMinor: 0, orders: 0, ids: new Set<string>() }]));
  for (const r of d.rows) {
    const day = days.get(dayKey(r.orderedAt));
    if (!day) continue;
    day.netMinor += r.netMinor;
    if (!r.cancelled) day.ids.add(r.orderId);
  }

  return {
    kpis: {
      views,
      addToCarts: carts,
      orders,
      netRevenueMinor: net,
      grossMinor: gross,
      discountsMinor: disc,
      refundedMinor: gross - disc - net,
      averageOrderMinor: orders > 0 ? Math.floor(net / orders) : null,
      viewToCartRate: ratio(carts, views),
      ordersPerCart: ratio(orders, carts),
      discountRate: ratio(disc, gross),
      refundRate: ratio(gross - disc - net, gross - disc),
    },
    perBundle,
    daily: [...days.values()].map(({ date, netMinor, ids }) => ({ date, netMinor, orders: ids.size })),
  };
}

/** A "nice" axis maximum (1, 2, 2.5, 5 or 10 times a power of ten) at or above the data, so ticks land on round numbers. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return Math.round(m * pow);
  return pow * 10;
}

export const percent = (r: number | null, digits = 1) => (r === null ? "—" : `${(r * 100).toFixed(digits)}%`);
