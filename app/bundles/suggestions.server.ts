import { previewBundle } from "./pricingPreview";
import { coveredPairs, minePairs, SMALL_SAMPLE, type Basket } from "./suggestions";
import type { VariantDetail } from "./shopifyCatalog.server";
import type { StoredBundle } from "./types";

export const SUGGESTION_DAYS = 60;
export const DEFAULT_DISCOUNT_BPS = 1000;
const CACHE_MS = 10 * 60_000;

export interface Suggestion {
  key: string;
  variants: { variantId: string; productId: string; title: string; priceMinor: number }[];
  together: number;
  /** Percent of orders containing either product that contained both (0 to 100). */
  sharePct: number;
  lift: number;
  smallSample: boolean;
  listPriceMinor: number;
  discountPct: number;
  discountMinor: number;
  bundlePriceMinor: number;
  createUrl: string;
}

export interface SuggestionResult {
  generatedAt: string;
  days: number;
  orders: number;
  multiItemOrders: number;
  /** True when more orders existed than were read (the most recent ones were used). */
  truncated: boolean;
  suggestions: Suggestion[];
}

const numeric = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

export async function buildSuggestions(d: {
  now: Date;
  bundles: Pick<StoredBundle, "status" | "items">[];
  fetchBaskets: (since: Date) => Promise<{ baskets: Basket[]; truncated: boolean }>;
  fetchVariants: (ids: string[]) => Promise<Map<string, VariantDetail>>;
}): Promise<SuggestionResult> {
  const since = new Date(d.now.getTime() - SUGGESTION_DAYS * 86_400_000);
  const { baskets, truncated } = await d.fetchBaskets(since);
  // Draft and archived bundles do not stop a pair being suggested; live and paused ones do.
  const mined = minePairs(baskets, {
    covered: coveredPairs(d.bundles.filter((b) => b.status === "active" || b.status === "paused")),
    limit: 12,
  });
  const ids = [...new Set(mined.pairs.flatMap((p) => [p.a, p.b]))];
  const details = ids.length ? await d.fetchVariants(ids) : new Map<string, VariantDetail>();

  const suggestions: Suggestion[] = [];
  for (const p of mined.pairs) {
    const va = details.get(p.a);
    const vb = details.get(p.b);
    // A product that was deleted, archived or is no longer a different product cannot be bundled.
    if (!va || !vb || va.productId === vb.productId || va.productStatus !== "ACTIVE" || vb.productStatus !== "ACTIVE") continue;
    const title = (v: VariantDetail) => (v.variantTitle === "Default Title" ? v.productTitle : `${v.productTitle} – ${v.variantTitle}`);
    const prices = { [p.a]: va.priceMinor, [p.b]: vb.priceMinor };
    const pv = previewBundle(
      { name: "", status: "draft", pricingKind: "percentage", pricingValue: DEFAULT_DISCOUNT_BPS, items: [
        { productId: va.productId, variantId: p.a, quantity: 1 },
        { productId: vb.productId, variantId: p.b, quantity: 1 },
      ] },
      prices,
    );
    suggestions.push({
      key: p.key,
      variants: [
        { variantId: p.a, productId: va.productId, title: title(va), priceMinor: va.priceMinor },
        { variantId: p.b, productId: vb.productId, title: title(vb), priceMinor: vb.priceMinor },
      ],
      together: p.together,
      sharePct: Math.round(p.share * 100),
      lift: Math.round(p.lift * 10) / 10,
      smallSample: p.together < SMALL_SAMPLE,
      listPriceMinor: pv.subtotalMinor,
      discountPct: DEFAULT_DISCOUNT_BPS / 100,
      discountMinor: pv.discountMinor,
      bundlePriceMinor: pv.totalMinor,
      createUrl: `/app/bundles/new?variants=${numeric(p.a)},${numeric(p.b)}&discount=${DEFAULT_DISCOUNT_BPS / 100}`,
    });
  }
  return {
    generatedAt: d.now.toISOString(),
    days: SUGGESTION_DAYS,
    orders: mined.orders,
    multiItemOrders: mined.multiItemOrders,
    truncated,
    suggestions: suggestions.slice(0, 10),
  };
}

/** Small per-process cache: reading 60 days of orders is the slow part, and the answer barely changes in minutes. */
export function createSuggestionCache(ttlMs = CACHE_MS) {
  const m = new Map<string, { at: number; value: SuggestionResult }>();
  return {
    get(shop: string, now = Date.now()) {
      const e = m.get(shop);
      return e && now - e.at < ttlMs ? e.value : null;
    },
    set(shop: string, value: SuggestionResult, now = Date.now()) {
      m.set(shop, { at: now, value });
    },
    clear(shop: string) {
      m.delete(shop);
    },
  };
}

/** Parses the create-bundle prefill link: 2 to 10 numeric variant ids and a percentage between 1 and 100. */
export function parsePrefill(params: URLSearchParams): { variantGids: string[]; discountBps: number } | null {
  const ids = [...new Set((params.get("variants") ?? "").split(",").map((s) => s.trim()))];
  if (ids.length < 2 || ids.length > 10 || ids.some((s) => !/^\d{1,20}$/.test(s))) return null;
  const pct = Number(params.get("discount"));
  const bps = Number.isFinite(pct) && pct >= 1 && pct <= 100 ? Math.round(pct * 100) : DEFAULT_DISCOUNT_BPS;
  return { variantGids: ids.map((n) => `gid://shopify/ProductVariant/${n}`), discountBps: bps };
}
