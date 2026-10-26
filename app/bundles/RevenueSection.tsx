import type { ReactNode } from "react";
import { formatMinor } from "./format";
import { KpiGrid } from "./KpiTile";
import { revenueViewState, type BundleTotals, type RevenueTotals } from "./revenueSummary";

export interface RevenueSectionProps {
  days: number;
  currency: string;
  revenue: RevenueTotals;
  byBundle: (BundleTotals & { name: string })[];
  unmapped: { minor: number; orders: number };
  otherCurrencyOrders: number;
  sync: { lastSyncedAt: string | null; error: string | null; errorCode: string | null };
  onPeriodChange: (days: number) => void;
  /** The "Sync orders now" form, supplied by the route (it needs the router). */
  syncControl: ReactNode;
  /** The dashboard shows these figures as headline cards above, so it hides the tiles here. */
  hideTiles?: boolean;
}

/** Presentation only. What it may claim is decided by revenueViewState, so a failed sync never reads as $0. */
export function RevenueSection({
  days, currency, revenue, byBundle: revenueByBundle, unmapped: unmappedRefunds, otherCurrencyOrders, sync, onPeriodChange, syncControl, hideTiles,
}: RevenueSectionProps) {
  const money = (m: number) => formatMinor(m, currency);
  const view = revenueViewState(sync, revenue);
  return (
  <s-section heading="Bundle revenue">
    <s-stack gap="base">
      <s-stack direction="inline" gap="base">
        <s-select
          label="Period"
          value={String(days)}
          onChange={(e: Event) => onPeriodChange(Number((e.currentTarget as HTMLSelectElement).value))}
        >
          {[7, 30, 60].map((d) => (
            <s-option key={d} value={String(d)}>
              Last {d} days
            </s-option>
          ))}
        </s-select>
        {syncControl}
      </s-stack>

      {sync.error && (
        <s-banner
          tone={sync.errorCode === "FAILED" ? "warning" : "critical"}
          heading={
            sync.errorCode === "ACCESS_NOT_APPROVED"
              ? "Shopify has not approved order access for this app"
              : sync.lastSyncedAt
                ? "The latest revenue sync failed"
                : "Revenue sync is not working"
          }
        >
          <s-paragraph>{sync.error}</s-paragraph>
          {sync.errorCode === "ACCESS_NOT_APPROVED" && (
            <s-paragraph>
              Revenue cannot be shown until this is approved. Nothing below is zero; it is simply unavailable.
            </s-paragraph>
          )}
          {sync.lastSyncedAt && <s-paragraph>Showing data from the last successful sync.</s-paragraph>}
        </s-banner>
      )}

      {view === "unavailable" || view === "unsynced" ? (
        // Never synced successfully: we know nothing about orders, so do not print zeros that look like data.
        <s-paragraph>
          {view === "unavailable" ? "Revenue is unavailable." : "Revenue has not been synced yet. Click “Sync orders now”."}
        </s-paragraph>
      ) : view === "empty" ? (
        <s-paragraph>
          Synced, and there are no bundle orders in this period ({money(0)} revenue). Bundle purchases appear here after
          they are placed and synced.
        </s-paragraph>
      ) : (
        <>
          {!hideTiles && (
          <KpiGrid
              items={[
                { label: "Net bundle revenue", value: money(revenue.netRevenueMinor) },
                { label: "Bundle orders", value: String(revenue.orders) },
                { label: "Average bundle order", value: money(revenue.averageOrderMinor) },
                { label: "Discounts given", value: money(revenue.discountsMinor) },
              ]}
            />
          )}
          <s-stack gap="small">
            <s-text>Gross bundle sales (list price): {money(revenue.grossSalesMinor)}</s-text>
            <s-text>Net sold (after bundle discounts, before refunds): {money(revenue.netSoldMinor)}</s-text>
            <s-text>
              Refunds and cancellations: -{money(revenue.refundedMinor)} ({revenue.unitsRefunded} units refunded,{" "}
              {revenue.cancelledOrders} orders cancelled)
            </s-text>
            <s-text>
              Orders: {revenue.liveOrders} tracked live, {revenue.historicalOrders} historical (imported from before
              tracking began)
            </s-text>
          </s-stack>
          {otherCurrencyOrders > 0 && (
            <s-banner tone="info">
              <s-paragraph>
                {otherCurrencyOrders} order(s) in another currency are not included in these {currency} totals.
              </s-paragraph>
            </s-banner>
          )}
          {revenue.unreconciledOrders > 0 && (
            <s-banner tone="warning">
              <s-paragraph>
                {revenue.unreconciledOrders} order(s) could not be matched to the discount Shopify recorded, so their
                figures are estimates.
              </s-paragraph>
            </s-banner>
          )}
          {unmappedRefunds.minor > 0 && (
            <s-banner tone="info">
              <s-paragraph>
                {money(unmappedRefunds.minor)} was refunded on {unmappedRefunds.orders} order(s) without naming
                products (for example shipping, tax or a custom amount). It is not deducted from bundle revenue.
              </s-paragraph>
            </s-banner>
          )}
          <s-section padding="none">
            <s-table>
              <s-table-header-row>
                <s-table-header>Bundle</s-table-header>
                <s-table-header>Orders</s-table-header>
                <s-table-header>Units</s-table-header>
                <s-table-header>Net revenue</s-table-header>
                <s-table-header>Discounts</s-table-header>
                <s-table-header>Refunded</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {revenueByBundle.map((b) => (
                  <s-table-row key={b.bundleId}>
                    <s-table-cell>{b.name}</s-table-cell>
                    <s-table-cell>{b.orders}</s-table-cell>
                    <s-table-cell>{b.unitsSold}</s-table-cell>
                    <s-table-cell>{money(b.netRevenueMinor)}</s-table-cell>
                    <s-table-cell>{money(b.discountsMinor)}</s-table-cell>
                    <s-table-cell>{money(b.refundedMinor)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        </>
      )}
      <s-text>
        Net revenue = what customers paid for bundle items after bundle discounts, excluding tax and shipping, minus
        refunded items and cancelled orders. Last synced: {sync.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString() : "never"}.
      </s-text>
    </s-stack>
  </s-section>
  );
}
