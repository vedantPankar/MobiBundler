// Pure: finds product pairs that were bought together, from nothing but each order's set of variant ids.
// No customer data is involved or stored. Everything here is a description of PAST orders, never a forecast.

export interface Basket {
  orderId: string;
  variantIds: string[];
}

export interface MinedPair {
  /** Sorted pair key, "a|b". */
  key: string;
  a: string;
  b: string;
  /** Orders containing both. */
  together: number;
  ordersWithA: number;
  ordersWithB: number;
  /** together / orders containing either (0 to 1). */
  share: number;
  /** How much more often they co-occur than chance would suggest (1 = no association). */
  lift: number;
}

export interface MineResult {
  pairs: MinedPair[];
  /** Orders with at least one variant. */
  orders: number;
  /** Orders with two or more distinct variants (the only ones that can form a pair). */
  multiItemOrders: number;
  /** Orders skipped because their basket was too large to be a meaningful pairing. */
  skippedLarge: number;
}

export const MAX_BASKET = 30;
export const SMALL_SAMPLE = 5;
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Every pair of variants that an existing bundle already combines, so they are not suggested again. */
export function coveredPairs(bundles: { items: { variantId: string }[] }[]): Set<string> {
  const out = new Set<string>();
  for (const b of bundles) {
    const v = [...new Set(b.items.map((i) => i.variantId))];
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) out.add(pairKey(v[i], v[j]));
  }
  return out;
}

export function minePairs(
  baskets: Basket[],
  o: { minTogether?: number; limit?: number; covered?: Set<string> } = {},
): MineResult {
  const minTogether = o.minTogether ?? 2;
  const single = new Map<string, number>();
  const both = new Map<string, number>();
  let orders = 0;
  let multi = 0;
  let skippedLarge = 0;

  for (const b of baskets) {
    const v = [...new Set(b.variantIds)].sort();
    if (v.length === 0) continue;
    orders++;
    for (const id of v) single.set(id, (single.get(id) ?? 0) + 1);
    if (v.length < 2) continue;
    if (v.length > MAX_BASKET) {
      skippedLarge++;
      continue;
    }
    multi++;
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
      const k = `${v[i]}|${v[j]}`;
      both.set(k, (both.get(k) ?? 0) + 1);
    }
  }

  const pairs: MinedPair[] = [];
  for (const [key, together] of both) {
    if (together < minTogether || o.covered?.has(key)) continue;
    const [a, b] = key.split("|");
    const ca = single.get(a)!;
    const cb = single.get(b)!;
    pairs.push({ key, a, b, together, ordersWithA: ca, ordersWithB: cb, share: together / (ca + cb - together), lift: (together * orders) / (ca * cb) });
  }
  pairs.sort((x, y) => y.together - x.together || y.lift - x.lift || (x.key < y.key ? -1 : 1));
  return { pairs: pairs.slice(0, o.limit ?? 10), orders, multiItemOrders: multi, skippedLarge };
}
