// Pure: no Shopify imports. Shared by the Function (re-exported from extensions/bundle-discount/src/engine.ts) and the admin preview.

export type PricingModel =
  | { kind: "percentage"; basisPoints: number }
  | { kind: "fixed_amount_off"; amountMinor: number };

/**
 * The label the Function puts on each discount it applies. Shopify records exactly this as the title of the
 * order's AutomaticDiscountApplication (seen on real order #1001), so revenue reconciliation finds our discount by it.
 */
export const BUNDLE_DISCOUNT_MESSAGE = "Bundle discount";

export interface BundleEntry {
  id: string;
  pricing: { kind: string } & Record<string, unknown>;
  items: { variantId: string; quantity: number }[];
}
export interface CartLineInput {
  id: string;
  variantId: string;
  quantity: number;
  unitPriceMinor: number;
}
export interface Allocation {
  bundleId: string;
  lineId: string;
  quantity: number;
  discountMinor: number;
}

const ZERO = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "XPF", "PYG", "RWF"]);
const THREE = new Set(["BHD", "KWD", "OMR", "JOD", "TND", "IQD", "LYD"]);

export function currencyExponent(code: string): number {
  return ZERO.has(code) ? 0 : THREE.has(code) ? 3 : 2;
}

export function toMinor(amount: string, exp: number): number {
  const [i, f = ""] = amount.split(".");
  return Number(i + (f + "0".repeat(exp)).slice(0, exp));
}

export function fromMinor(minor: number, exp: number): string {
  const s = String(minor).padStart(exp + 1, "0");
  return exp === 0 ? s : `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

/** Split `total` across `weights` proportionally; sums exactly (largest remainder, ties by index). */
export function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const base = weights.map((w) => Math.floor((total * w) / sum));
  const rems = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let left = total - base.reduce((a, b) => a + b, 0);
  rems.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && k < rems.length; k++, left--) base[rems[k].i]++;
  return base;
}

type Handler = (pricing: BundleEntry["pricing"], sets: number, subtotal: number) => number;

// Dispatch on pricing.kind; unknown kinds are skipped so newer configs never crash an older Function.
const handlers: Record<string, Handler> = {
  percentage: (p, _sets, subtotal) => Math.floor((subtotal * Number(p.basisPoints)) / 10000),
  fixed_amount_off: (p, sets, subtotal) => Math.min(Number(p.amountMinor) * sets, subtotal),
};

function validEntry(b: BundleEntry): boolean {
  const p = b.pricing;
  if (p.kind === "percentage") {
    if (!Number.isInteger(p.basisPoints) || (p.basisPoints as number) <= 0 || (p.basisPoints as number) > 10000) return false;
  } else if (p.kind === "fixed_amount_off") {
    if (!Number.isInteger(p.amountMinor) || (p.amountMinor as number) <= 0) return false;
  } else {
    return false;
  }
  const items = b.items;
  if (items.length === 0) return false;
  // Bundles hold at most a handful of components, so a quadratic duplicate check beats allocating a Set.
  for (let i = 0; i < items.length; i++) {
    if (!Number.isInteger(items[i].quantity) || items[i].quantity < 1) return false;
    for (let j = 0; j < i; j++) if (items[j].variantId === items[i].variantId) return false;
  }
  return true;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface DetailedAllocation {
  bundleId: string;
  sets: number;
  /** Every unit consumed by the bundle, including units whose share of the discount rounds to zero. */
  chunks: { lineId: string; quantity: number; subtotalMinor: number; discountMinor: number }[];
}

/** Discounted units only, exactly what the checkout Function applies. */
export function allocate(bundles: BundleEntry[], lines: CartLineInput[]): Allocation[] {
  const out: Allocation[] = [];
  for (const d of allocateDetailed(bundles, lines)) {
    for (const c of d.chunks) {
      if (c.discountMinor > 0) out.push({ bundleId: d.bundleId, lineId: c.lineId, quantity: c.quantity, discountMinor: c.discountMinor });
    }
  }
  return out;
}

/** Same algorithm as before, additionally reporting sets and zero-discount units for revenue attribution. */
export function allocateDetailed(bundles: BundleEntry[], lines: CartLineInput[]): DetailedAllocation[] {
  const remaining = new Map<string, number>();
  const byVariant = new Map<string, CartLineInput[]>();
  const avail = new Map<string, number>();
  for (const l of lines) {
    if (l.quantity <= 0) continue;
    remaining.set(l.id, l.quantity);
    const arr = byVariant.get(l.variantId);
    if (arr) arr.push(l);
    else byVariant.set(l.variantId, [l]);
    avail.set(l.variantId, (avail.get(l.variantId) ?? 0) + l.quantity);
  }
  if (byVariant.size === 0) return [];
  for (const arr of byVariant.values()) {
    if (arr.length > 1) arr.sort((a, b) => b.unitPriceMinor - a.unitPriceMinor || cmp(a.id, b.id));
  }

  // Cheap pre-filter: a bundle can only apply if every component variant is in the cart in sufficient
  // quantity. Keeps cost proportional to bundles that can actually match, not all configured bundles.
  const ranked: { b: BundleEntry; saving: number }[] = [];
  for (const b of bundles) {
    if (!validEntry(b)) continue;
    let perSet = 0;
    let possible = true;
    for (const it of b.items) {
      if ((avail.get(it.variantId) ?? 0) < it.quantity) {
        possible = false;
        break;
      }
      perSet += it.quantity * byVariant.get(it.variantId)![0].unitPriceMinor;
    }
    if (possible) ranked.push({ b, saving: handlers[b.pricing.kind](b.pricing, 1, perSet) });
  }
  ranked.sort((x, y) => y.saving - x.saving || cmp(x.b.id, y.b.id));

  const out: DetailedAllocation[] = [];
  for (const { b } of ranked) {
    let sets = Infinity;
    for (const it of b.items) {
      sets = Math.min(sets, Math.floor((avail.get(it.variantId) ?? 0) / it.quantity));
      if (sets < 1) break;
    }
    if (!(sets >= 1)) continue;
    const chunks: { lineId: string; quantity: number; subtotal: number }[] = [];
    for (const it of b.items) {
      let need = sets * it.quantity;
      avail.set(it.variantId, (avail.get(it.variantId) ?? 0) - need);
      for (const l of byVariant.get(it.variantId)!) {
        if (need === 0) break;
        const have = remaining.get(l.id) ?? 0;
        const take = have < need ? have : need;
        if (take === 0) continue;
        remaining.set(l.id, have - take);
        chunks.push({ lineId: l.id, quantity: take, subtotal: take * l.unitPriceMinor });
        need -= take;
      }
    }
    let subtotal = 0;
    for (const c of chunks) subtotal += c.subtotal;
    const totalDiscount = handlers[b.pricing.kind](b.pricing, sets, subtotal);
    const shares = distribute(totalDiscount, chunks.map((c) => c.subtotal));
    out.push({
      bundleId: b.id,
      sets,
      chunks: chunks.map((c, i) => ({
        lineId: c.lineId,
        quantity: c.quantity,
        subtotalMinor: c.subtotal,
        discountMinor: shares[i],
      })),
    });
  }
  return out;
}
