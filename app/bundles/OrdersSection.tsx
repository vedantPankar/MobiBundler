import { Card } from "./KpiTile";
import { formatMinor } from "./format";
import { ORDER_FILTERS, type OrderFilter, type OrderListRow } from "./orderRows";
import { revenueViewState } from "./revenueSummary";

export interface OrdersSectionProps {
  rows: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  days: number;
  filter: OrderFilter;
  currency: string;
  sync: { lastSyncedAt: string | null; error: string | null };
  onChange: (next: { days?: number; filter?: OrderFilter; page?: number }) => void;
}

const FILTER_LABEL: Record<OrderFilter, string> = {
  all: "All orders",
  live: "Tracked live",
  historical: "Historical",
  estimates: "Estimates only",
  refunded: "With refunds",
  cancelled: "Cancelled",
};
const STATE_LABEL = { paid: "Paid", partly_refunded: "Partly refunded", refunded: "Refunded", cancelled: "Cancelled" } as const;
const STATE_TONE = { paid: "success", partly_refunded: "warning", refunded: "warning", cancelled: "critical" } as const;

function OrdersTable({ rows, money }: { rows: OrderListRow[]; money: (m: number) => string }) {
  return (
  <s-table>
    <s-table-header-row>
      <s-table-header>Order</s-table-header>
      <s-table-header>Date</s-table-header>
      <s-table-header>Bundle</s-table-header>
      <s-table-header>Units</s-table-header>
      <s-table-header>Gross</s-table-header>
      <s-table-header>Discount</s-table-header>
      <s-table-header>Refunded</s-table-header>
      <s-table-header>Net revenue</s-table-header>
      <s-table-header>Status</s-table-header>
    </s-table-header-row>
    <s-table-body>
      {rows.map((r) => (
        <s-table-row key={r.orderId}>
          <s-table-cell>
            <s-link href={`shopify:admin/orders/${r.numericId}`} target="_top">
              {r.label}
            </s-link>
            <s-badge tone={r.source === "live" ? "info" : "neutral"}>{r.source === "live" ? "Live" : "Historical"}</s-badge>
          </s-table-cell>
          <s-table-cell>{new Date(r.orderedAt).toLocaleDateString()}</s-table-cell>
          <s-table-cell>{r.bundles.map((b) => b.name).join(", ") || "—"}</s-table-cell>
          <s-table-cell>{r.unitsSold}</s-table-cell>
          <s-table-cell>{money(r.grossMinor)}</s-table-cell>
          <s-table-cell>{money(r.discountMinor)}</s-table-cell>
          <s-table-cell>{money(r.refundedMinor)}</s-table-cell>
          <s-table-cell>{money(r.netMinor)}</s-table-cell>
          <s-table-cell>
            <s-badge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</s-badge>
            {r.estimate && <s-badge tone="warning">Estimate</s-badge>}
            {r.estimate && r.estimateReason && <s-text>{r.estimateReason}</s-text>}
            {r.unmappedRefundMinor > 0 && <s-text>{money(r.unmappedRefundMinor)} refunded without naming products</s-text>}
          </s-table-cell>
        </s-table-row>
      ))}
    </s-table-body>
  </s-table>
  );
}

export interface RecentOrdersProps {
  rows: OrderListRow[];
  total: number;
  currency: string;
  sync: { lastSyncedAt: string | null; error: string | null };
}

/** Compact version for the dashboard: the newest few orders and a link to the full page. */
export function RecentOrders({ rows, total, currency, sync }: RecentOrdersProps) {
  const view = revenueViewState(sync, { orders: total, cancelledOrders: 0 });
  // The revenue section above already explains an unsynced or unavailable state; do not repeat it here.
  if (view === "unavailable" || view === "unsynced") return null;
  const money = (m: number) => formatMinor(m, currency);
  return (
    <Card
      title="Recent bundle orders"
      icon="cart"
      action={
        rows.length > 0 ? (
          <a className="mb-card__action" href="/app/orders">
            View all {total} order(s)
          </a>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <s-paragraph>Synced, and there are no bundle orders yet.</s-paragraph>
      ) : (
        <ul className="mb-list">
          {rows.map((r) => (
            <li className="mb-row" key={r.orderId}>
              <div className="mb-row__main">
                <a className="mb-row__name" href={`shopify:admin/orders/${r.numericId}`} target="_top">
                  {r.label}
                </a>
                <div className="mb-row__sub">
                  {new Date(r.orderedAt).toLocaleDateString()} · {r.bundles.map((x) => x.name).join(", ") || "—"} · {r.unitsSold} item(s)
                </div>
                {r.estimate && <div className="mb-row__sub">Estimate{r.estimateReason ? `: ${r.estimateReason}` : ""}</div>}
              </div>
              <b>{money(r.netMinor)}</b>
              <span className={r.state === "paid" ? "mb-pill" : "mb-pill mb-pill--grey"}>{STATE_LABEL[r.state]}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Presentation only. As on the dashboard, a failed or missing sync is never shown as "no orders". */
export function OrdersSection({ rows, total, page, pageSize, days, filter, currency, sync, onChange }: OrdersSectionProps) {
  const money = (m: number) => formatMinor(m, currency);
  const view = revenueViewState(sync, { orders: total, cancelledOrders: 0 });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (view === "unavailable" || view === "unsynced") {
    return (
      <s-section>
        <s-paragraph>
          {view === "unavailable"
            ? "Orders are unavailable: Shopify order access is not working. See the dashboard for the reason."
            : "Orders have not been synced yet. Open the dashboard and click “Sync orders now”."}
        </s-paragraph>
      </s-section>
    );
  }

  return (
    <>
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-select label="Period" value={String(days)} onChange={(e: Event) => onChange({ days: Number((e.currentTarget as HTMLSelectElement).value), page: 1 })}>
            {[7, 30, 60].map((d) => (
              <s-option key={d} value={String(d)}>
                Last {d} days
              </s-option>
            ))}
          </s-select>
          <s-select label="Show" value={filter} onChange={(e: Event) => onChange({ filter: (e.currentTarget as HTMLSelectElement).value as OrderFilter, page: 1 })}>
            {ORDER_FILTERS.map((f) => (
              <s-option key={f} value={f}>
                {FILTER_LABEL[f]}
              </s-option>
            ))}
          </s-select>
        </s-stack>
      </s-section>

      {rows.length === 0 ? (
        <s-section>
          <s-paragraph>
            {filter === "all"
              ? `Synced, and there are no bundle orders in the last ${days} days.`
              : `No orders match “${FILTER_LABEL[filter]}” in the last ${days} days.`}
          </s-paragraph>
        </s-section>
      ) : (
        <s-section padding="none">
          <OrdersTable rows={rows} money={money} />
        </s-section>
      )}

      <s-section>
        <s-stack direction="inline" gap="base">
          <s-text>
            {total} order(s) · page {page} of {pages}
          </s-text>
          <button type="button" disabled={page <= 1} onClick={() => onChange({ page: page - 1 })}>
            Previous
          </button>
          <button type="button" disabled={page >= pages} onClick={() => onChange({ page: page + 1 })}>
            Next
          </button>
        </s-stack>
      </s-section>
    </>
  );
}
