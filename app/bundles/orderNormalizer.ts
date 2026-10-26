// The ONLY place that knows the shape of Shopify's order data. Everything downstream (attribution, ingestion,
// dashboard) works on NormalizedOrder, so confirming or correcting the real payload shape only touches this file
// and the query in ordersSource.server.ts.
//
// Checked against ONE real order (#1001, tests/fixtures/order-1001.json): line items, quantities, shop-currency
// prices, discount allocations and the automatic discount's title match. Refunds, cancellations, order edits and
// other currencies have not been seen in a real payload yet.
import { BUNDLE_DISCOUNT_MESSAGE, currencyExponent, toMinor } from "./engine";
import type { OrderLine, RefundEvent } from "./attribution";

type Money = { shopMoney?: { amount?: string; currencyCode?: string } } | null | undefined;

export interface RawOrder {
  id: string;
  /** The order number as the merchant sees it, e.g. "#1001". Not customer data. UNVERIFIED in a real payload. */
  name?: string;
  createdAt: string;
  updatedAt?: string;
  cancelledAt?: string | null;
  currencyCode?: string;
  lineItems?: { pageInfo?: { hasNextPage?: boolean }; nodes?: RawLine[] };
  refunds?: RawRefund[];
}
interface RawLine {
  id: string;
  quantity: number;
  currentQuantity?: number;
  variant?: { id: string } | null;
  originalUnitPriceSet?: Money;
  discountAllocations?: {
    allocatedAmountSet?: Money;
    discountApplication?: { __typename?: string; title?: string } | null;
  }[];
}
interface RawRefund {
  id: string;
  totalRefundedSet?: Money;
  refundLineItems?: { pageInfo?: { hasNextPage?: boolean }; nodes?: { quantity: number; lineItem?: { id: string } | null }[] };
}

export interface NormalizedOrder {
  orderId: string;
  orderName: string | null;
  orderedAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  currencyCode: string;
  lines: OrderLine[];
  refunds: RefundEvent[];
  /** What Shopify recorded as discounted by our automatic discount, per line, in minor units. */
  recordedDiscountByLine: Record<string, number>;
  /** Sum of refunds that name no order lines: may be shipping, tax or a manual amount, so never applied to items. */
  unmappedRefundMinor: number;
  /** Reasons the data may be incomplete; any entry makes the order unreconciled. */
  warnings: string[];
  /** Informational only (does not block reconciliation), e.g. a quantity that changed after purchase. */
  notes: string[];
}

export function normalizeOrder(raw: RawOrder): NormalizedOrder {
  const warnings: string[] = [];
  const notes: string[] = [];
  const nodes = raw.lineItems?.nodes ?? [];
  const firstCode = nodes.map((l) => l.originalUnitPriceSet?.shopMoney?.currencyCode).find(Boolean);
  const currencyCode = firstCode ?? raw.currencyCode ?? "USD";
  const exp = currencyExponent(currencyCode);

  if (raw.lineItems?.pageInfo?.hasNextPage) warnings.push("order has more line items than were read");

  const lines: OrderLine[] = [];
  const recordedDiscountByLine: Record<string, number> = {};
  for (const l of nodes) {
    const price = l.originalUnitPriceSet?.shopMoney?.amount;
    if (!l.variant?.id || price === undefined || !Number.isInteger(l.quantity) || l.quantity <= 0) {
      if (l.variant?.id) warnings.push(`line ${l.id} has no usable price or quantity`);
      continue; // custom items and deleted variants can never be part of a bundle
    }
    lines.push({ id: l.id, variantId: l.variant.id, quantity: l.quantity, unitPriceMinor: toMinor(price, exp) });
    let recorded = 0;
    for (const a of l.discountAllocations ?? []) {
      const app = a.discountApplication;
      if (app?.__typename === "AutomaticDiscountApplication" && app.title === BUNDLE_DISCOUNT_MESSAGE) {
        recorded += toMinor(a.allocatedAmountSet?.shopMoney?.amount ?? "0", exp);
      }
    }
    if (recorded > 0) recordedDiscountByLine[l.id] = recorded;
    if (l.currentQuantity !== undefined && l.currentQuantity !== l.quantity) {
      notes.push(`line ${l.id} quantity changed after purchase (order edit or refund; original quantity is used)`);
    }
  }

  const refunds: RefundEvent[] = [];
  let unmappedRefundMinor = 0;
  for (const r of raw.refunds ?? []) {
    const items = r.refundLineItems?.nodes ?? [];
    if (r.refundLineItems?.pageInfo?.hasNextPage) warnings.push(`refund ${r.id} has more line items than were read`);
    const mapped = items
      .filter((i) => i.lineItem?.id && Number.isInteger(i.quantity) && i.quantity > 0)
      .map((i) => ({ lineId: i.lineItem!.id, quantity: i.quantity }));
    if (mapped.length > 0) refunds.push({ refundId: r.id, lines: mapped });
    else unmappedRefundMinor += toMinor(r.totalRefundedSet?.shopMoney?.amount ?? "0", exp);
  }

  return {
    orderId: raw.id,
    orderName: typeof raw.name === "string" && raw.name.length <= 40 ? raw.name : null,
    orderedAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt ?? raw.createdAt),
    cancelledAt: raw.cancelledAt ? new Date(raw.cancelledAt) : null,
    currencyCode,
    lines,
    refunds,
    recordedDiscountByLine,
    unmappedRefundMinor,
    warnings,
    notes,
  };
}
