// Pure: no Shopify, database or route code. Turns an order's lines into per-bundle revenue by replaying the same
// engine the checkout Function uses, then applies refunds and cancellations.
//
// Net bundle revenue = amount paid for bundle-attributed units after the bundle discount, before tax and shipping.
// All money is integer minor units. Rounding:
//   - the discount for a bundle is split across its units by the engine (largest remainder, sums exactly);
//   - a partly refunded chunk gives back its per-unit gross exactly, and its per-unit discount as
//     floor(D / Q) with the D % Q leftover cents going to the first units. Refunding all Q units therefore returns
//     exactly D, never more or less.
//
// UNVERIFIED against real Shopify orders: that an order line's quantity and price are the engine's inputs, that a
// refund maps to order lines by quantity, and that other discounts do not touch bundle lines. See the questions list.
import { allocateDetailed, type BundleEntry, type CartLineInput } from "./engine";

export type OrderLine = CartLineInput;

export interface AttributedChunk {
  bundleId: string;
  lineId: string;
  /** Needed to recount intact sets after refunds. Absent on attributions stored by older code. */
  variantId?: string;
  quantity: number;
  unitPriceMinor: number;
  grossMinor: number;
  discountMinor: number;
}

export interface OrderAttribution {
  chunks: AttributedChunk[];
  /** Sets the engine formed at purchase, per bundle. See BundleRevenue.sets for the figure after refunds. */
  sets: Record<string, number>;
  /** What each bundle needs per set, so intact sets can be recounted after refunds. Absent on older records. */
  bundleItems?: Record<string, { variantId: string; quantity: number }[]>;
  /** Units on each order line, bundle or not. Needed to cap refunds. */
  lineQuantity: Record<string, number>;
}

/** Which units of the order belong to which bundle. Units not in any bundle (mixed carts) are not attributed. */
export function attributeOrder(bundles: BundleEntry[], lines: OrderLine[]): OrderAttribution {
  const price = new Map(lines.map((l) => [l.id, l.unitPriceMinor]));
  const variant = new Map(lines.map((l) => [l.id, l.variantId]));
  const chunks: AttributedChunk[] = [];
  const sets: Record<string, number> = {};
  const bundleItems: Record<string, { variantId: string; quantity: number }[]> = {};
  const byId = new Map(bundles.map((b) => [b.id, b]));
  for (const d of allocateDetailed(bundles, lines)) {
    sets[d.bundleId] = d.sets;
    bundleItems[d.bundleId] = (byId.get(d.bundleId)?.items ?? []).map((i) => ({ variantId: i.variantId, quantity: i.quantity }));
    for (const c of d.chunks) {
      chunks.push({
        bundleId: d.bundleId,
        lineId: c.lineId,
        variantId: variant.get(c.lineId),
        quantity: c.quantity,
        unitPriceMinor: price.get(c.lineId) ?? 0,
        grossMinor: c.subtotalMinor,
        discountMinor: c.discountMinor,
      });
    }
  }
  const lineQuantity: Record<string, number> = {};
  for (const l of lines) lineQuantity[l.id] = (lineQuantity[l.id] ?? 0) + Math.max(0, l.quantity);
  return { chunks, sets, bundleItems, lineQuantity };
}

export interface RefundEvent {
  /** Identity of the refund. Delivering the same refund twice must not deduct twice. */
  refundId: string;
  lines: { lineId: string; quantity: number }[];
}

export interface BundleRevenue {
  bundleId: string;
  /**
   * Complete sets still intact: units left after refunds, counted per variant against what one set needs. A refund
   * that breaks a set lowers it; a cancelled order has none. Falls back to the purchased count (and cannot drop) for
   * attributions stored without item details.
   */
  sets: number;
  unitsSold: number;
  unitsRefunded: number;
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
}

/** Discount given back for `k` of `q` units of a chunk that carried `discount` in total (see rounding note). */
function refundedDiscount(discount: number, q: number, k: number): number {
  const base = Math.floor(discount / q);
  const rem = discount % q;
  return k * base + Math.min(k, rem);
}

/**
 * Revenue per bundle after refunds and cancellation.
 * - Refunds are keyed by refundId (a repeated id is the same refund) and capped at each line's quantity, so
 *   replays and over-reporting can never push revenue below what was actually sold.
 * - A refunded unit is assumed to be a bundle unit first (conservative: revenue is never overstated). The
 *   remaining refunded units are non-bundle units and do not touch bundle revenue.
 * - A cancelled order has no revenue. Refunds on it are ignored, so cancelling never double-deducts.
 */
export function revenueAfterAdjustments(
  a: OrderAttribution,
  refunds: RefundEvent[],
  cancelled: boolean,
): BundleRevenue[] {
  const ids = [...new Set(a.chunks.map((c) => c.bundleId))].sort();
  const rows = new Map<string, BundleRevenue>(
    ids.map((id) => [
      id,
      { bundleId: id, sets: cancelled ? 0 : a.sets[id] ?? 0, unitsSold: 0, unitsRefunded: 0, grossMinor: 0, discountMinor: 0, netMinor: 0 },
    ]),
  );
  if (cancelled) return [...rows.values()];

  const byRefund = new Map<string, RefundEvent>();
  for (const r of refunds) byRefund.set(r.refundId, r);
  const refundedByLine = new Map<string, number>();
  for (const r of byRefund.values()) {
    for (const l of r.lines) {
      if (!Number.isInteger(l.quantity) || l.quantity <= 0) continue;
      refundedByLine.set(l.lineId, (refundedByLine.get(l.lineId) ?? 0) + l.quantity);
    }
  }

  // Per line, hand refunded units to its bundle chunks in a stable order (bundle id).
  const left = new Map<string, number>();
  const bundleUnitsOnLine = new Map<string, number>();
  for (const c of a.chunks) bundleUnitsOnLine.set(c.lineId, (bundleUnitsOnLine.get(c.lineId) ?? 0) + c.quantity);
  for (const [lineId, qty] of refundedByLine) {
    const capped = Math.min(qty, a.lineQuantity[lineId] ?? 0);
    left.set(lineId, Math.min(capped, bundleUnitsOnLine.get(lineId) ?? 0));
  }

  const remaining = new Map<string, Map<string, number>>(); // bundle -> variant -> units left
  const ordered = [...a.chunks].sort((x, y) => (x.bundleId < y.bundleId ? -1 : x.bundleId > y.bundleId ? 1 : 0));
  for (const c of ordered) {
    const row = rows.get(c.bundleId)!;
    const k = Math.min(left.get(c.lineId) ?? 0, c.quantity);
    left.set(c.lineId, (left.get(c.lineId) ?? 0) - k);
    const gross = c.grossMinor - k * c.unitPriceMinor;
    const discount = c.discountMinor - refundedDiscount(c.discountMinor, c.quantity, k);
    if (c.variantId) {
      const m = remaining.get(c.bundleId) ?? new Map<string, number>();
      m.set(c.variantId, (m.get(c.variantId) ?? 0) + c.quantity - k);
      remaining.set(c.bundleId, m);
    }
    row.unitsSold += c.quantity;
    row.unitsRefunded += k;
    row.grossMinor += gross;
    row.discountMinor += discount;
    row.netMinor += gross - discount;
  }
  for (const row of rows.values()) {
    const items = a.bundleItems?.[row.bundleId];
    const left = remaining.get(row.bundleId);
    if (!items || items.length === 0 || !left) continue; // older record: keep the purchased count
    let sets = Infinity;
    for (const it of items) sets = Math.min(sets, Math.floor((left.get(it.variantId) ?? 0) / it.quantity));
    row.sets = Math.min(row.sets, Number.isFinite(sets) ? sets : 0);
  }
  return [...rows.values()];
}
