import { createHash } from "node:crypto";
import { attributeOrder, revenueAfterAdjustments, type OrderAttribution } from "./attribution";
import type { BundleEntry } from "./engine";
import type { NormalizedOrder } from "./orderNormalizer";
import type { RevenueRepo, RevenueRowInput } from "./revenue.repo.server";

export type IngestResult = "created" | "updated" | "unchanged" | "no_bundle";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Replayed bundle discount per order line (what the checkout engine would apply), minor units. */
function replayedByLine(a: OrderAttribution): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of a.chunks) if (c.discountMinor > 0) out[c.lineId] = (out[c.lineId] ?? 0) + c.discountMinor;
  return out;
}

/** Compares our replay with the discount Shopify recorded for our discount. Returns a reason when they differ. */
export function reconcile(a: OrderAttribution, recorded: Record<string, number>, warnings: string[]): string | null {
  if (warnings.length > 0) return warnings.join("; ");
  const replay = replayedByLine(a);
  for (const id of new Set([...Object.keys(replay), ...Object.keys(recorded)])) {
    const r = replay[id] ?? 0;
    const s = recorded[id] ?? 0;
    if (r !== s) return `line ${id}: replay discounts ${r} but Shopify recorded ${s} (minor units)`;
  }
  return null;
}

/**
 * Idempotent: ingesting the same order any number of times, in any order relative to other orders, leaves the same
 * rows. Attribution strategy (documented in docs/revenue-tracking.md):
 *  - A reconciled order keeps its stored attribution, so later bundle edits never rewrite history. Only refunds and
 *    cancellation are re-applied to it.
 *  - An unreconciled order is re-attributed with the current bundles each time it is seen.
 *  - If the order's lines change (order edit), the stored attribution is discarded and replayed afresh.
 */
type IngestDeps = {
  shop: string;
  repo: RevenueRepo;
  bundles: BundleEntry[];
  /** bundle id -> its configured currency; a mismatch with the order's currency makes the order unreconciled. */
  currencies?: Record<string, string>;
  trackingStartedAt: Date;
  order: NormalizedOrder;
};

export async function ingestOrder(d: IngestDeps): Promise<IngestResult> {
  try {
    return await ingestOnce(d);
  } catch (e) {
    // Two writers (sync + webhook, or two processes) inserted the same new order: the loser retries as an update.
    if ((e as { code?: string })?.code === "P2002") return ingestOnce(d);
    throw e;
  }
}

async function ingestOnce(d: IngestDeps): Promise<IngestResult> {
  const { shop, repo, order } = d;
  const linesHash = sha(JSON.stringify(order.lines));
  const refunds = [...order.refunds].sort((a, b) => (a.refundId < b.refundId ? -1 : 1));
  const fingerprint = sha(
    JSON.stringify({
      linesHash,
      name: order.orderName,
      refunds,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      recorded: order.recordedDiscountByLine,
      unmapped: order.unmappedRefundMinor,
      warnings: order.warnings,
    }),
  );

  const existing = await repo.getOrder(shop, order.orderId);
  // An unreconciled order is always re-evaluated: the bundle config may have been fixed since it was last seen.
  if (existing && existing.reconciled && existing.fingerprint === fingerprint) return "unchanged";

  const frozen = existing && existing.reconciled && existing.linesHash === linesHash;
  const attribution: OrderAttribution = frozen
    ? (JSON.parse(existing.attributionJson) as OrderAttribution)
    : attributeOrder(d.bundles, order.lines);

  const hasBundle = attribution.chunks.length > 0 || Object.keys(order.recordedDiscountByLine).length > 0;
  if (!existing && !hasBundle) return "no_bundle"; // never store orders unrelated to bundles

  const warnings = [...order.warnings];
  for (const id of new Set(attribution.chunks.map((c) => c.bundleId))) {
    const cur = d.currencies?.[id];
    if (!frozen && cur && cur !== order.currencyCode) {
      warnings.push(`bundle ${id} is priced in ${cur} but the order is in ${order.currencyCode}`);
    }
  }
  const mismatch = frozen ? null : reconcile(attribution, order.recordedDiscountByLine, warnings);
  const reconciled = frozen ? true : mismatch === null;
  const note = frozen ? existing.reconcileNote : [mismatch, ...order.notes].filter(Boolean).join("; ") || null;

  // Re-evaluating an unreconciled order that comes out identical must not rewrite its rows (no churn, stable ids).
  if (
    existing &&
    existing.fingerprint === fingerprint &&
    existing.reconciled === reconciled &&
    existing.reconcileNote === note &&
    existing.attributionJson === JSON.stringify(attribution)
  ) {
    return "unchanged";
  }

  const cancelled = order.cancelledAt !== null;
  const sold = new Map(revenueAfterAdjustments(attribution, [], false).map((r) => [r.bundleId, r]));
  const rows: RevenueRowInput[] = revenueAfterAdjustments(attribution, order.refunds, cancelled).map((after) => {
    const s = sold.get(after.bundleId)!;
    return {
      bundleId: after.bundleId,
      sets: after.sets, // complete sets still intact after refunds and cancellation
      unitsSold: s.unitsSold,
      unitsRefunded: after.unitsRefunded,
      soldGrossMinor: s.grossMinor,
      soldDiscountMinor: s.discountMinor,
      netMinor: after.netMinor,
    };
  });

  await repo.saveOrder(
    {
      shop,
      orderId: order.orderId,
      orderName: order.orderName,
      orderedAt: order.orderedAt,
      cancelledAt: order.cancelledAt,
      currencyCode: order.currencyCode,
      source: existing ? (existing.source as "live" | "backfill") : order.orderedAt < d.trackingStartedAt ? "backfill" : "live",
      fingerprint,
      linesHash,
      linesJson: JSON.stringify(order.lines),
      refundsJson: JSON.stringify(refunds),
      attributionJson: JSON.stringify(attribution),
      reconciled,
      reconcileNote: note,
      unmappedRefundMinor: order.unmappedRefundMinor,
    },
    rows,
  );
  return existing ? "updated" : "created";
}
