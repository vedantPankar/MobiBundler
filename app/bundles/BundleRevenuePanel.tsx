import { formatMinor } from "./format";
import { revenueViewState, type RevenueTotals } from "./revenueSummary";

export interface BundleRevenuePanelProps {
  days: number;
  currency: string;
  totals: RevenueTotals;
  sync: { lastSyncedAt: string | null; error: string | null };
}

/** Last-N-days revenue for one bundle. Same rule as the dashboard: a failed or missing sync never reads as $0. */
export function BundleRevenuePanel({ days, currency, totals, sync }: BundleRevenuePanelProps) {
  const money = (m: number) => formatMinor(m, currency);
  const view = revenueViewState(sync, totals);
  return (
    <s-section heading={`Revenue, last ${days} days`}>
      {view === "unavailable" || view === "unsynced" ? (
        <s-paragraph>
          {view === "unavailable"
            ? "Revenue is unavailable: Shopify order access is not working. See the dashboard for details."
            : "Revenue has not been synced yet. Open the dashboard and click “Sync orders now”."}
        </s-paragraph>
      ) : view === "empty" ? (
        <s-paragraph>No orders for this bundle in this period ({money(0)} revenue).</s-paragraph>
      ) : (
        <s-stack gap="small">
          <s-text>Net revenue: {money(totals.netRevenueMinor)}</s-text>
          <s-text>Orders: {totals.orders} ({totals.cancelledOrders} cancelled)</s-text>
          <s-text>Discounts given: {money(totals.discountsMinor)}</s-text>
          <s-text>Refunded or cancelled: {money(totals.refundedMinor)}</s-text>
          {totals.unreconciledOrders > 0 && (
            <s-text>{totals.unreconciledOrders} order(s) are estimates (could not be matched to Shopify's discount).</s-text>
          )}
        </s-stack>
      )}
    </s-section>
  );
}
