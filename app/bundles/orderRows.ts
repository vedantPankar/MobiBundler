// Pure: turns stored order records and their per-bundle revenue rows into the rows the Orders page shows.
export const ORDER_FILTERS = ["all", "live", "historical", "estimates", "refunded", "cancelled"] as const;
export type OrderFilter = (typeof ORDER_FILTERS)[number];
export const parseOrderFilter = (v: string | null): OrderFilter => ORDER_FILTERS.find((f) => f === v) ?? "all";

export interface OrderRecordLite {
  orderId: string;
  orderName: string | null;
  orderedAt: Date;
  cancelledAt: Date | null;
  source: string;
  reconciled: boolean;
  reconcileNote: string | null;
  unmappedRefundMinor: number;
}
export interface RevenueRowLite {
  orderId: string;
  bundleId: string;
  unitsSold: number;
  unitsRefunded: number;
  soldGrossMinor: number;
  soldDiscountMinor: number;
  netMinor: number;
}

export type OrderState = "paid" | "partly_refunded" | "refunded" | "cancelled";

export interface OrderListRow {
  orderId: string;
  /** "#1001" when known, otherwise a short form of the id (orders stored before the number was captured). */
  label: string;
  /** Numeric id for the admin deep link. */
  numericId: string;
  orderedAt: string;
  source: "live" | "historical";
  state: OrderState;
  estimate: boolean;
  estimateReason: string | null;
  bundles: { bundleId: string; name: string; units: number }[];
  unitsSold: number;
  unitsRefunded: number;
  grossMinor: number;
  discountMinor: number;
  /** Net after refunds and cancellation (what counts as revenue). */
  netMinor: number;
  /** Net sold minus net: the value of refunded units, or of the whole order when cancelled. */
  refundedMinor: number;
  unmappedRefundMinor: number;
}

const numeric = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

export function buildOrderRows(
  records: OrderRecordLite[],
  revenue: RevenueRowLite[],
  bundleNames: Map<string, string>,
): OrderListRow[] {
  const byOrder = new Map<string, RevenueRowLite[]>();
  for (const r of revenue) byOrder.set(r.orderId, [...(byOrder.get(r.orderId) ?? []), r]);

  return records.map((rec) => {
    const rows = (byOrder.get(rec.orderId) ?? []).sort((a, b) => (a.bundleId < b.bundleId ? -1 : 1));
    const sum = (f: (r: RevenueRowLite) => number) => rows.reduce((s, r) => s + f(r), 0);
    const gross = sum((r) => r.soldGrossMinor);
    const discount = sum((r) => r.soldDiscountMinor);
    const net = sum((r) => r.netMinor);
    const sold = sum((r) => r.unitsSold);
    const refunded = sum((r) => r.unitsRefunded);
    const cancelled = rec.cancelledAt !== null;
    const state: OrderState = cancelled
      ? "cancelled"
      : refunded === 0
        ? "paid"
        : refunded >= sold
          ? "refunded"
          : "partly_refunded";
    const id = numeric(rec.orderId);
    return {
      orderId: rec.orderId,
      label: rec.orderName ?? `Order …${id.slice(-6)}`,
      numericId: id,
      orderedAt: rec.orderedAt.toISOString(),
      source: rec.source === "backfill" ? "historical" : "live",
      state,
      estimate: !rec.reconciled,
      estimateReason: rec.reconciled ? null : rec.reconcileNote,
      bundles: rows.map((r) => ({ bundleId: r.bundleId, name: bundleNames.get(r.bundleId) ?? "Deleted bundle", units: r.unitsSold })),
      unitsSold: sold,
      unitsRefunded: refunded,
      grossMinor: gross,
      discountMinor: discount,
      netMinor: net,
      refundedMinor: gross - discount - net,
      unmappedRefundMinor: rec.unmappedRefundMinor,
    };
  });
}
