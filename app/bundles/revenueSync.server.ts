import { buildSharedConfig } from "./config";
import { normalizeOrder, type RawOrder } from "./orderNormalizer";
import type { BundleRepo } from "./repo.server";
import type { RevenueRepo } from "./revenue.repo.server";
import { ingestOrder, type IngestResult } from "./revenueIngest.server";

export const BACKFILL_DAYS = 60;
const OVERLAP_MS = 5 * 60_000; // re-read a little before the cursor so a clock skew can never skip an order

export interface OrdersPage {
  orders: RawOrder[];
  hasNext: boolean;
  endCursor: string | null;
}
export type FetchOrdersPage = (a: { updatedSince: Date; after: string | null }) => Promise<OrdersPage>;

export interface SyncSummary {
  ok: boolean;
  /** Set when ok is false. */
  errorCode?: SyncErrorCode;
  /** More pages remained when the page limit was hit; the next sync resumes where this one stopped. */
  partial?: boolean;
  /** "backfill" on the first run (reads the last 60 days), "incremental" afterwards. */
  mode: "backfill" | "incremental";
  seen: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  error?: string;
}

export type SyncErrorCode = "ACCESS_NOT_APPROVED" | "ACCESS_DENIED" | "FAILED";

/** Turns a failure into a stable code plus something a merchant can act on. */
export function classifySyncError(e: unknown): { code: SyncErrorCode; message: string } {
  const m = e instanceof Error ? e.message : String(e);
  if (/not approved to access the Order object/i.test(m)) {
    return {
      code: "ACCESS_NOT_APPROVED",
      message:
        "Shopify has not approved this app to read orders yet. Request protected customer data access (Level 1) for MobiBundler in the Dev Dashboard, restart the app, then sync again.",
    };
  }
  if (/access denied|read_orders|forbidden|unauthori[sz]ed/i.test(m)) {
    return { code: "ACCESS_DENIED", message: "Shopify denied access to orders. Check the app has the read_orders permission." };
  }
  return { code: "FAILED", message: "Order sync failed. It will retry automatically." };
}

const locks = new Map<string, Promise<unknown>>();
/** Serialises revenue work per shop within one process so a dashboard refresh and a webhook cannot interleave. */
export function withRevenueLock<T>(shop: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(shop) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(shop, next);
  next.finally(() => {
    if (locks.get(shop) === next) locks.delete(shop);
  }).catch(() => {});
  return next;
}

/**
 * Pull-based ingestion: reads orders updated since the last cursor (or the last 60 days on first run) and ingests
 * each. Safe to re-run at any time: ingestion is idempotent, and the cursor only advances when every order in the
 * run was processed, so a failed order is retried rather than skipped.
 */
export function syncOrders(d: Parameters<typeof runSync>[0]): Promise<SyncSummary> {
  return withRevenueLock(d.shop, () => runSync(d));
}

async function runSync(d: {
  shop: string;
  repo: RevenueRepo;
  bundleRepo: BundleRepo;
  fetchPage: FetchOrdersPage;
  /** Re-reads one order. When given, orders last seen as estimates are re-checked on every sync. */
  fetchOrder?: (gid: string) => Promise<RawOrder | null>;
  now?: Date;
  maxPages?: number;
}): Promise<SyncSummary> {
  const now = d.now ?? new Date();
  const state = await d.repo.ensureState(d.shop, now);
  const first = state.lastOrderUpdatedAt === null;
  const updatedSince = first
    ? new Date(now.getTime() - BACKFILL_DAYS * 86_400_000)
    : new Date(state.lastOrderUpdatedAt!.getTime() - OVERLAP_MS);
  const out: SyncSummary = {
    ok: true, mode: first ? "backfill" : "incremental", seen: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0,
  };

  try {
    // Draft bundles never apply at checkout. Paused/archived ones may have been active when the order was placed.
    const stored = (await d.bundleRepo.list(d.shop)).filter((b) => b.status !== "draft");
    const bundles = buildSharedConfig(stored).bundles;
    const currencies = Object.fromEntries(stored.map((b) => [b.id, b.currencyCode]));
    let after: string | null = null;
    let newest: Date | null = null;
    const maxPages = d.maxPages ?? 20;
    for (let page = 0; page < maxPages; page++) {
      const p = await d.fetchPage({ updatedSince, after });
      for (const raw of p.orders) {
        out.seen++;
        try {
          const order = normalizeOrder(raw);
          const r = await ingestOrder({ shop: d.shop, repo: d.repo, bundles, currencies, trackingStartedAt: state.trackingStartedAt, order });
          if (r === "created") out.created++;
          else if (r === "updated") out.updated++;
          else if (r === "unchanged") out.unchanged++;
          else out.skipped++;
          if (!newest || order.updatedAt > newest) newest = order.updatedAt;
        } catch (e) {
          out.failed++;
          console.error(JSON.stringify({ evt: "order_ingest_failed", shop: d.shop, orderId: raw.id, err: (e as Error).name }));
        }
      }
      if (!p.hasNext || !p.endCursor) break;
      if (page === maxPages - 1) out.partial = true; // sorted oldest-update first, so resuming from `newest` is safe
      after = p.endCursor;
    }
    // The cursor only moves forward, so an order flagged as an estimate would never be read again. Re-check those
    // (a bounded number per run) so they recover once the bundle config or this code has been corrected.
    if (d.fetchOrder) {
      for (const gid of await d.repo.unreconciledOrderIds(d.shop, 25)) {
        try {
          const raw = await d.fetchOrder(gid);
          if (!raw) continue;
          const r = await ingestOrder({ shop: d.shop, repo: d.repo, bundles, currencies, trackingStartedAt: state.trackingStartedAt, order: normalizeOrder(raw) });
          if (r === "updated") out.updated++;
        } catch (e) {
          out.failed++;
          console.error(JSON.stringify({ evt: "order_recheck_failed", shop: d.shop, orderId: gid, err: (e as Error).name }));
        }
      }
    }
    await d.repo.recordSuccess(d.shop, now, out.failed === 0 ? newest : null);
    console.log(JSON.stringify({ evt: "order_sync", shop: d.shop, ...out }));
  } catch (e) {
    out.ok = false;
    const c = classifySyncError(e);
    out.error = c.message;
    out.errorCode = c.code;
    await d.repo.recordError(d.shop, now, c.message, c.code);
    console.error(JSON.stringify({ evt: "order_sync_failed", shop: d.shop, err: (e as Error).message }));
  }
  return out;
}


/**
 * Webhook entry point: the verified webhook only supplies an order id; the order itself is re-read from Shopify and
 * ingested through the same idempotent path as the sync. Duplicate, late or out-of-order deliveries therefore all
 * converge on Shopify's current state. UNVERIFIED: which webhook topics are delivered, and in what order.
 */
export function ingestOrderById(d: {
  shop: string;
  orderGid: string;
  repo: RevenueRepo;
  bundleRepo: BundleRepo;
  fetchOrder: (gid: string) => Promise<RawOrder | null>;
  now?: Date;
}): Promise<IngestResult | "not_found"> {
  return withRevenueLock(d.shop, async () => {
    const state = await d.repo.ensureState(d.shop, d.now ?? new Date());
    const raw = await d.fetchOrder(d.orderGid);
    if (!raw) return "not_found";
    const stored = (await d.bundleRepo.list(d.shop)).filter((b) => b.status !== "draft");
    return ingestOrder({
      shop: d.shop,
      repo: d.repo,
      bundles: buildSharedConfig(stored).bundles,
      currencies: Object.fromEntries(stored.map((b) => [b.id, b.currencyCode])),
      trackingStartedAt: state.trackingStartedAt,
      order: normalizeOrder(raw),
    });
  });
}
