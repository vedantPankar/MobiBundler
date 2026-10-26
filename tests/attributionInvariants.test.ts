import { expect, test } from "vitest";
import { allocate, type BundleEntry } from "../app/bundles/engine";
import { attributeOrder, revenueAfterAdjustments, type OrderLine, type RefundEvent } from "../app/bundles/attribution";

// Seeded pseudo-random carts: the invariants must hold for ANY cart, not just the hand-picked ones.
function rng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}
const V = ["v1", "v2", "v3", "v4"];

function scenario(seed: number) {
  const r = rng(seed);
  const bundles: BundleEntry[] = [];
  for (let i = 0; i < 2 + r(3); i++) {
    // two or three distinct variants per bundle (bundles may overlap on a variant)
    const start = r(V.length);
    const size = 2 + r(2);
    const picks = Array.from({ length: size }, (_, k) => V[(start + k) % V.length]);
    bundles.push({
      id: `b${i}`,
      pricing: r(2) === 0 ? { kind: "percentage", basisPoints: 1 + r(10000) } : { kind: "fixed_amount_off", amountMinor: 1 + r(5000) },
      items: picks.map((variantId) => ({ variantId, quantity: 1 + r(2) })),
    });
  }
  const lines: OrderLine[] = V.flatMap((variantId, i) => (r(6) === 0 ? [] : [{ id: `L${i}`, variantId, quantity: 1 + r(6), unitPriceMinor: 1 + r(100000) }]));
  return { bundles, lines, r };
}

test("the random carts are not vacuous: most produce bundles, attributed units, discounts and refunds", () => {
  let withChunks = 0, withDiscount = 0, multiBundle = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { bundles, lines } = scenario(seed);
    const a = attributeOrder(bundles, lines);
    if (a.chunks.length) withChunks++;
    if (a.chunks.some((c) => c.discountMinor > 0)) withDiscount++;
    if (new Set(a.chunks.map((c) => c.bundleId)).size > 1) multiBundle++;
  }
  expect(withChunks).toBeGreaterThan(60);
  expect(withDiscount).toBeGreaterThan(60);
  expect(multiBundle).toBeGreaterThan(5);
});

test("200 random carts: money invariants, refunds and idempotency hold", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { bundles, lines, r } = scenario(seed);
    const a = attributeOrder(bundles, lines);
    const sold = revenueAfterAdjustments(a, [], false);

    // same discount the checkout engine applies
    const engine = allocate(bundles, lines).reduce((s, x) => s + x.discountMinor, 0);
    expect(a.chunks.reduce((s, c) => s + c.discountMinor, 0)).toBe(engine);

    // no unit is attributed twice, and every row adds up
    const perLine: Record<string, number> = {};
    for (const c of a.chunks) perLine[c.lineId] = (perLine[c.lineId] ?? 0) + c.quantity;
    for (const l of lines) expect(perLine[l.id] ?? 0).toBeLessThanOrEqual(l.quantity);
    for (const row of sold) {
      expect(row.netMinor).toBe(row.grossMinor - row.discountMinor);
      expect(row.discountMinor).toBeLessThanOrEqual(row.grossMinor);
      expect(row.netMinor).toBeGreaterThanOrEqual(0);
    }

    // refunds: never below zero, never more units than sold, monotone, duplicates ignored
    const events: RefundEvent[] = lines.map((l, i) => ({ refundId: `r${i}`, lines: [{ lineId: l.id, quantity: r(l.quantity + 2) }] }));
    let prevNet = sold.reduce((s, x) => s + x.netMinor, 0);
    for (let k = 1; k <= events.length; k++) {
      const rows = revenueAfterAdjustments(a, events.slice(0, k), false);
      const net = rows.reduce((s, x) => s + x.netMinor, 0);
      expect(net).toBeLessThanOrEqual(prevNet);
      expect(net).toBeGreaterThanOrEqual(0);
      for (const row of rows) expect(row.unitsRefunded).toBeLessThanOrEqual(row.unitsSold);
      prevNet = net;
    }
    expect(revenueAfterAdjustments(a, [...events, ...events], false)).toEqual(revenueAfterAdjustments(a, events, false));

    // refunding everything returns exactly zero; cancelling is zero too
    const all: RefundEvent = { refundId: "all", lines: lines.map((l) => ({ lineId: l.id, quantity: l.quantity })) };
    for (const row of revenueAfterAdjustments(a, [all], false)) {
      expect([row.grossMinor, row.discountMinor, row.netMinor, row.sets]).toEqual([0, 0, 0, 0]);
    }
    for (const row of revenueAfterAdjustments(a, events, true)) expect([row.netMinor, row.sets]).toEqual([0, 0]);
  }
});
