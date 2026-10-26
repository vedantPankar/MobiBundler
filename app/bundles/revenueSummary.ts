// Pure dashboard maths over BundleOrderRevenue rows. All money in integer minor units of one currency.
export interface RevenueRow {
  orderId: string;
  bundleId: string;
  source: string;
  cancelled: boolean;
  reconciled: boolean;
  unitsSold: number;
  unitsRefunded: number;
  soldGrossMinor: number;
  soldDiscountMinor: number;
  netMinor: number;
}

export interface RevenueTotals {
  /** Bundle units' list price before the bundle discount, before refunds. */
  grossSalesMinor: number;
  discountsMinor: number;
  /** gross - discounts: what customers were charged for bundle units, before refunds and cancellations. */
  netSoldMinor: number;
  /** netSold - netRevenue: value of refunded units and cancelled orders. */
  refundedMinor: number;
  /** After bundle discounts, refunds and cancellations; excludes tax and shipping. */
  netRevenueMinor: number;
  /** Orders containing at least one bundle, not cancelled. */
  orders: number;
  cancelledOrders: number;
  /** netRevenue / orders, rounded down; 0 with no orders. */
  averageOrderMinor: number;
  unitsSold: number;
  unitsRefunded: number;
  /** Orders whose attribution could not be matched to Shopify's recorded discounts. Their numbers are estimates. */
  unreconciledOrders: number;
  historicalOrders: number;
  liveOrders: number;
}

export interface BundleTotals extends RevenueTotals {
  bundleId: string;
}

function totalsOf(rows: RevenueRow[]): RevenueTotals {
  const active = new Set<string>();
  const cancelled = new Set<string>();
  const unreconciled = new Set<string>();
  const hist = new Set<string>();
  const live = new Set<string>();
  const t = { gross: 0, disc: 0, net: 0, units: 0, refunded: 0 };
  for (const r of rows) {
    t.gross += r.soldGrossMinor;
    t.disc += r.soldDiscountMinor;
    t.net += r.netMinor;
    t.units += r.unitsSold;
    t.refunded += r.unitsRefunded;
    (r.cancelled ? cancelled : active).add(r.orderId);
    if (!r.reconciled) unreconciled.add(r.orderId);
    if (!r.cancelled) (r.source === "backfill" ? hist : live).add(r.orderId);
  }
  const netSold = t.gross - t.disc;
  const orders = active.size;
  return {
    grossSalesMinor: t.gross,
    discountsMinor: t.disc,
    netSoldMinor: netSold,
    refundedMinor: netSold - t.net,
    netRevenueMinor: t.net,
    orders,
    cancelledOrders: cancelled.size,
    averageOrderMinor: orders > 0 ? Math.floor(t.net / orders) : 0,
    unitsSold: t.units,
    unitsRefunded: t.refunded,
    unreconciledOrders: unreconciled.size,
    historicalOrders: hist.size,
    liveOrders: live.size,
  };
}

export function summarizeRevenue(rows: RevenueRow[]): { total: RevenueTotals; byBundle: BundleTotals[] } {
  const groups = new Map<string, RevenueRow[]>();
  for (const r of rows) groups.set(r.bundleId, [...(groups.get(r.bundleId) ?? []), r]);
  const byBundle = [...groups.entries()]
    .map(([bundleId, rs]) => ({ bundleId, ...totalsOf(rs) }))
    .sort((a, b) => b.netRevenueMinor - a.netRevenueMinor || (a.bundleId < b.bundleId ? -1 : 1));
  return { total: totalsOf(rows), byBundle };
}

export type RevenueViewState =
  /** Order access failed and we have never synced: we know nothing, so show no numbers. */
  | "unavailable"
  /** Nothing has been attempted yet. */
  | "unsynced"
  /** A sync succeeded and there are no bundle orders in the period: a real zero. */
  | "empty"
  | "data";

/** Decides what the dashboard may claim. A zero is only shown as zero when a sync has actually succeeded. */
export function revenueViewState(
  sync: { lastSyncedAt: string | null; error: string | null },
  totals: Pick<RevenueTotals, "orders" | "cancelledOrders">,
): RevenueViewState {
  if (!sync.lastSyncedAt) return sync.error ? "unavailable" : "unsynced";
  return totals.orders + totals.cancelledOrders === 0 ? "empty" : "data";
}

/** Money is never added across currencies: keep the shop currency's rows and count the orders left out. */
export function splitByCurrency<T extends { currencyCode: string; orderId: string }>(
  rows: T[],
  shopCurrency: string,
): { rows: T[]; otherCurrencyOrders: number } {
  const kept = rows.filter((r) => r.currencyCode === shopCurrency);
  const other = new Set(rows.filter((r) => r.currencyCode !== shopCurrency).map((r) => r.orderId));
  return { rows: kept, otherCurrencyOrders: other.size };
}

export const SYNC_RETRY_MS = 5 * 60_000;

/**
 * Whether opening the dashboard should refresh orders. A recent failed attempt counts like a recent success, so a
 * missing Shopify permission is not retried on every page view.
 */
export function shouldSyncRevenue(
  state: { lastSyncedAt: Date | null; lastErrorAt: Date | null } | null,
  now = new Date(),
): boolean {
  const times = [state?.lastSyncedAt, state?.lastErrorAt].filter((d): d is Date => !!d);
  if (times.length === 0) return true;
  return now.getTime() - Math.max(...times.map((d) => d.getTime())) > SYNC_RETRY_MS;
}
