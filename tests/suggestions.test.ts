import { describe, expect, test, vi } from "vitest";
import { coveredPairs, minePairs, pairKey, MAX_BASKET, type Basket } from "../app/bundles/suggestions";
import { buildSuggestions, createSuggestionCache, parsePrefill, type SuggestionResult } from "../app/bundles/suggestions.server";
import { BASKET_MAX_PAGES, ORDER_BASKETS_QUERY, fetchBaskets } from "../app/bundles/ordersSource.server";
import type { VariantDetail } from "../app/bundles/shopifyCatalog.server";

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const b = (id: string, ...v: number[]): Basket => ({ orderId: id, variantIds: v.map(V) });

describe("pair mining", () => {
  test("counts orders containing both, ignores single-item orders, and ranks by count then lift", () => {
    const r = minePairs([b("1", 1, 2), b("2", 1, 2), b("3", 1, 2), b("4", 3, 4), b("5", 3, 4), b("6", 1), b("7", 9)]);
    expect(r.orders).toBe(7);
    expect(r.multiItemOrders).toBe(5);
    expect(r.pairs.map((p) => [p.a, p.b, p.together])).toEqual([[V(1), V(2), 3], [V(3), V(4), 2]]);
  });

  test("a variant repeated inside one order, or quantities, never inflate a pair", () => {
    expect(minePairs([b("1", 1, 1, 1, 2), b("2", 2, 1)], { minTogether: 1 }).pairs[0].together).toBe(2);
    expect(minePairs([b("1", 1, 1)]).pairs).toEqual([]);
  });

  test("a pair seen only once is not suggested by default, but can be with a lower threshold", () => {
    expect(minePairs([b("1", 1, 2)]).pairs).toEqual([]);
    expect(minePairs([b("1", 1, 2)], { minTogether: 1 }).pairs).toHaveLength(1);
  });

  test("share and lift are computed from the counts", () => {
    // A in 4 orders, B in 4, together in 2, 10 orders in total
    const baskets = [b("1", 1, 2), b("2", 1, 2), b("3", 1), b("4", 1), b("5", 2), b("6", 2), ...[7, 8, 9, 10].map((n) => b(String(n), 50 + n))];
    const [p] = minePairs(baskets).pairs;
    expect(p.together).toBe(2);
    expect(p.share).toBeCloseTo(2 / (4 + 4 - 2));
    expect(p.lift).toBeCloseTo((2 * 10) / (4 * 4));
  });

  test("pairs already inside a live bundle are excluded, in either order", () => {
    const covered = coveredPairs([{ items: [{ variantId: V(2) }, { variantId: V(1) }, { variantId: V(7) }] }]);
    expect(covered.has(pairKey(V(1), V(2)))).toBe(true);
    expect(covered.has(pairKey(V(7), V(1)))).toBe(true);
    const r = minePairs([b("1", 1, 2), b("2", 2, 1), b("3", 3, 4), b("4", 3, 4)], { covered });
    expect(r.pairs.map((p) => p.key)).toEqual([pairKey(V(3), V(4))]);
  });

  test("huge baskets are skipped (counted, not mined) so one wholesale order cannot dominate", () => {
    const big = b("big", ...Array.from({ length: MAX_BASKET + 1 }, (_, i) => 100 + i));
    const r = minePairs([big, big], { minTogether: 1 });
    expect(r.pairs).toEqual([]);
    expect(r.skippedLarge).toBe(2);
  });

  test("limit and deterministic order regardless of input order", () => {
    const base = [b("1", 1, 2), b("2", 1, 2), b("3", 3, 4), b("4", 3, 4), b("5", 5, 6), b("6", 5, 6)];
    const a = minePairs(base, { limit: 2 }).pairs.map((p) => p.key);
    const z = minePairs([...base].reverse(), { limit: 2 }).pairs.map((p) => p.key);
    expect(a).toHaveLength(2);
    expect(a).toEqual(z);
  });

  test("no orders: nothing, no crash", () => {
    expect(minePairs([])).toMatchObject({ pairs: [], orders: 0, multiItemOrders: 0 });
  });
});

const detail = (n: number, price: number, over: Partial<VariantDetail> = {}): VariantDetail => ({
  id: V(n), productId: `gid://shopify/Product/${n}`, productTitle: `Product ${n}`, variantTitle: "Default Title",
  productStatus: "ACTIVE", priceMinor: price, available: 5, imageUrl: null, ...over,
});
const NOW = new Date("2026-10-25T12:00:00Z");
const run = (baskets: Basket[], details: VariantDetail[], bundles: { status: "active" | "draft" | "paused" | "archived"; items: { variantId: string }[] }[] = [], truncated = false) => {
  const fetchVariants = vi.fn(async (ids: string[]) => new Map(details.filter((d) => ids.includes(d.id)).map((d) => [d.id, d])));
  return {
    fetchVariants,
    result: buildSuggestions({ now: NOW, bundles: bundles as never, fetchBaskets: async () => ({ baskets, truncated }), fetchVariants }),
  };
};

describe("building suggestions", () => {
  test("a suggestion carries names, past-order evidence, and the discount worked out by the checkout engine", async () => {
    const { result } = run([b("1", 1, 2), b("2", 1, 2), b("3", 1, 2)], [detail(1, 102500), detail(2, 74995, { variantTitle: "Ice" })]);
    const r = await result;
    expect(r.orders).toBe(3);
    const [s] = r.suggestions;
    expect(s.variants.map((v) => v.title)).toEqual(["Product 1", "Product 2 – Ice"]);
    expect(s).toMatchObject({ together: 3, sharePct: 100, listPriceMinor: 177495, discountMinor: 17749, bundlePriceMinor: 159746, discountPct: 10, smallSample: true });
    expect(s.createUrl).toBe("/app/bundles/new?variants=1,2&discount=10");
  });

  test("five or more orders is no longer a small sample", async () => {
    const baskets = Array.from({ length: 5 }, (_, i) => b(String(i), 1, 2));
    expect((await run(baskets, [detail(1, 1000), detail(2, 2000)]).result).suggestions[0].smallSample).toBe(false);
  });

  test("live and paused bundles suppress their pairs; draft and archived do not", async () => {
    const baskets = [b("1", 1, 2), b("2", 1, 2)];
    const d = [detail(1, 1000), detail(2, 2000)];
    const items = [{ variantId: V(1) }, { variantId: V(2) }];
    expect((await run(baskets, d, [{ status: "active", items }]).result).suggestions).toEqual([]);
    expect((await run(baskets, d, [{ status: "paused", items }]).result).suggestions).toEqual([]);
    expect((await run(baskets, d, [{ status: "draft", items }]).result).suggestions).toHaveLength(1);
    expect((await run(baskets, d, [{ status: "archived", items }]).result).suggestions).toHaveLength(1);
  });

  test("products that were deleted, are not active, or are two variants of one product are dropped", async () => {
    const baskets = [b("1", 1, 2), b("2", 1, 2), b("3", 1, 3), b("4", 1, 3), b("5", 4, 5), b("6", 4, 5)];
    const d = [detail(1, 1000), detail(2, 1000, { productStatus: "ARCHIVED" }), detail(4, 500), detail(5, 500, { productId: "gid://shopify/Product/4" })];
    expect((await run(baskets, d).result).suggestions).toEqual([]); // 3 is missing entirely
  });

  test("no orders, or nothing frequent: no variant lookup is made at all", async () => {
    const empty = run([], []);
    expect((await empty.result).suggestions).toEqual([]);
    expect(empty.fetchVariants).not.toHaveBeenCalled();
    const once = run([b("1", 1, 2)], [detail(1, 1), detail(2, 1)]);
    await once.result;
    expect(once.fetchVariants).not.toHaveBeenCalled();
  });

  test("truncation and the period are reported so the page can say what it read", async () => {
    const r = await run([b("1", 1, 2), b("2", 1, 2)], [detail(1, 1000), detail(2, 1000)], [], true).result;
    expect(r).toMatchObject({ truncated: true, days: 60, generatedAt: NOW.toISOString() });
  });

  test("an error reading orders propagates so the page can show the approval banner", async () => {
    await expect(buildSuggestions({ now: NOW, bundles: [], fetchBaskets: async () => { throw new Error("not approved to access the Order object"); }, fetchVariants: async () => new Map() })).rejects.toThrow("not approved");
  });
});

describe("cache", () => {
  const val = { generatedAt: "x" } as SuggestionResult;
  test("hit within the window, miss after it or after clear, and per shop", () => {
    const c = createSuggestionCache(1000);
    c.set("a", val, 0);
    expect(c.get("a", 999)).toBe(val);
    expect(c.get("a", 1000)).toBeNull();
    expect(c.get("b", 10)).toBeNull();
    c.set("a", val, 0);
    c.clear("a");
    expect(c.get("a", 1)).toBeNull();
  });
});

describe("create-bundle prefill link", () => {
  const q = (s: string) => new URLSearchParams(s);
  test("accepts 2 to 10 numeric variants and a 1 to 100 percent discount", () => {
    expect(parsePrefill(q("variants=1,2&discount=15"))).toEqual({ variantGids: [V(1), V(2)], discountBps: 1500 });
    expect(parsePrefill(q("variants=1,2"))?.discountBps).toBe(1000);
    expect(parsePrefill(q("variants=1,2&discount=0"))?.discountBps).toBe(1000);
    expect(parsePrefill(q("variants=1,2&discount=101"))?.discountBps).toBe(1000);
    expect(parsePrefill(q("variants=1,2&discount=abc"))?.discountBps).toBe(1000);
  });
  test("rejects anything else, so a crafted link cannot inject ids", () => {
    for (const bad of ["", "variants=1", "variants=1,1", "variants=1,x", "variants=gid://shopify/ProductVariant/1,2", "variants=1,2;DROP", `variants=${Array.from({ length: 11 }, (_, i) => i + 1).join(",")}`]) {
      expect(parsePrefill(q(bad))).toBeNull();
    }
  });
});

describe("reading baskets from Shopify (fake admin; query shape unverified)", () => {
  const pageOf = (ids: string[], hasNext: boolean, cursor = "c") => ({
    data: { orders: { pageInfo: { hasNextPage: hasNext, endCursor: cursor }, nodes: ids.map((o) => ({ id: o, lineItems: { nodes: [{ variant: { id: V(1) } }, { variant: null }] } })) } },
  });
  const admin = (responses: unknown[]) => {
    let n = 0;
    return { graphql: vi.fn(async () => ({ json: async () => responses[Math.min(n++, responses.length - 1)] })) };
  };

  test("maps orders to sets of variant ids, dropping custom items without a variant", async () => {
    const r = await fetchBaskets(admin([pageOf(["o1", "o2"], false)]) as never, new Date("2026-10-01T00:00:00Z"));
    expect(r).toEqual({ baskets: [{ orderId: "o1", variantIds: [V(1)] }, { orderId: "o2", variantIds: [V(1)] }], truncated: false });
  });

  test("follows pages, and says when it stopped before reading everything", async () => {
    const a = admin([pageOf(["o1"], true, "c1")]);
    const r = await fetchBaskets(a as never, new Date());
    expect(a.graphql).toHaveBeenCalledTimes(BASKET_MAX_PAGES);
    expect(r.truncated).toBe(true);
    expect(r.baskets).toHaveLength(BASKET_MAX_PAGES);
  });

  test("GraphQL errors throw", async () => {
    await expect(fetchBaskets(admin([{ errors: [{ message: "This app is not approved to access the Order object." }] }]) as never, new Date())).rejects.toThrow("not approved");
  });

  test("the query reads no customer, address, email, phone, note or price fields", () => {
    expect(ORDER_BASKETS_QUERY).not.toMatch(/customer|email|phone|address|billing|shipping|\bnote\b|firstName|lastName|displayName|price|name\b/i);
  });
});
