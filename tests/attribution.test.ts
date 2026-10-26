import { describe, expect, test } from "vitest";
import { allocate, type BundleEntry } from "../app/bundles/engine";
import { attributeOrder, revenueAfterAdjustments, type OrderLine } from "../app/bundles/attribution";

// Prices are the ones recorded for order #1001 (Oxygen $1,025.00, Liquid $749.95), used as inputs only; every
// figure asserted below is produced by the implementation or derived from it, not typed in from the order.
const OXY = "gid://shopify/ProductVariant/50798419509434";
const LIQ = "gid://shopify/ProductVariant/50798419411130";
const OTHER = "gid://shopify/ProductVariant/999";
const pct = (id: string, bps: number, ...items: [string, number][]): BundleEntry => ({
  id,
  pricing: { kind: "percentage", basisPoints: bps },
  items: items.map(([variantId, quantity]) => ({ variantId, quantity })),
});
const fbt = pct("fbt", 1000, [OXY, 1], [LIQ, 1]);
const line = (id: string, variantId: string, unitPriceMinor: number, quantity = 1): OrderLine => ({
  id,
  variantId,
  quantity,
  unitPriceMinor,
});
const sum = (rows: { netMinor: number }[]) => rows.reduce((s, r) => s + r.netMinor, 0);

describe("attribution replays the checkout engine", () => {
  test("single bundle: net equals the discounted subtotal and agrees with allocate()", () => {
    const lines = [line("L1", OXY, 102500), line("L2", LIQ, 74995)];
    const a = attributeOrder([fbt], lines);
    const [r] = revenueAfterAdjustments(a, [], false);
    expect(r).toMatchObject({ bundleId: "fbt", sets: 1, unitsSold: 2, grossMinor: 177495, discountMinor: 17749, netMinor: 159746 });
    // same discount the Function would apply, line by line
    const fn = allocate([fbt], lines);
    expect(a.chunks.map((c) => [c.lineId, c.discountMinor])).toEqual(fn.map((f) => [f.lineId, f.discountMinor]));
  });

  test("individually added products attribute exactly like a bundle added in one go (no line property involved)", () => {
    const together = attributeOrder([fbt], [line("A", OXY, 102500), line("B", LIQ, 74995)]);
    const apart = attributeOrder([fbt], [line("B", LIQ, 74995), line("A", OXY, 102500)]);
    const totals = (a: typeof together) => revenueAfterAdjustments(a, [], false)[0].netMinor;
    expect(totals(together)).toBe(totals(apart));
  });

  test("mixed cart: the unrelated item is not attributed", () => {
    const a = attributeOrder([fbt], [line("L1", OXY, 102500), line("L2", LIQ, 74995), line("X", OTHER, 5000)]);
    expect(a.chunks.some((c) => c.lineId === "X")).toBe(false);
    expect(sum(revenueAfterAdjustments(a, [], false))).toBe(159746);
  });

  test("incomplete bundle: nothing attributed", () => {
    expect(attributeOrder([fbt], [line("L1", OXY, 102500)]).chunks).toEqual([]);
  });

  test("quantity 2 forms two sets", () => {
    const a = attributeOrder([fbt], [line("L1", OXY, 102500, 2), line("L2", LIQ, 74995, 2)]);
    const [r] = revenueAfterAdjustments(a, [], false);
    expect(r.sets).toBe(2);
    expect(r.unitsSold).toBe(4);
    expect(r.grossMinor).toBe(177495 * 2);
    // The engine takes the percentage on the pooled subtotal of both sets, so the discount is
    // floor(354990 x 10%) = 35499, one cent more than two single-set discounts (2 x 17749). Revenue follows checkout.
    expect(r.discountMinor).toBe(35499);
    expect(r.discountMinor).toBe(allocate([fbt], [line("L1", OXY, 102500, 2), line("L2", LIQ, 74995, 2)]).reduce((s, x) => s + x.discountMinor, 0));
    expect(r.netMinor).toBe(r.grossMinor - r.discountMinor);
  });

  test("extra unit beyond the set stays out of bundle revenue", () => {
    const a = attributeOrder([fbt], [line("L1", OXY, 102500, 3), line("L2", LIQ, 74995, 1)]);
    const [r] = revenueAfterAdjustments(a, [], false);
    expect(r.unitsSold).toBe(2);
    expect(r.grossMinor).toBe(177495);
  });

  test("two bundles in one cart: each unit is attributed once and totals add up", () => {
    const other = pct("pair", 2000, [OTHER, 1], [LIQ, 1]); // overlaps on LIQ
    const lines = [line("L1", OXY, 102500), line("L2", LIQ, 74995), line("X", OTHER, 5000)];
    const a = attributeOrder([fbt, other], lines);
    const unitsPerLine: Record<string, number> = {};
    for (const c of a.chunks) unitsPerLine[c.lineId] = (unitsPerLine[c.lineId] ?? 0) + c.quantity;
    for (const [lineId, units] of Object.entries(unitsPerLine)) expect(units).toBeLessThanOrEqual(a.lineQuantity[lineId]);
    const rows = revenueAfterAdjustments(a, [], false);
    const gross = rows.reduce((s, r) => s + r.grossMinor, 0);
    const discount = rows.reduce((s, r) => s + r.discountMinor, 0);
    expect(discount).toBe(allocate([fbt, other], lines).reduce((s, x) => s + x.discountMinor, 0));
    expect(sum(rows)).toBe(gross - discount);
    expect(gross).toBeLessThanOrEqual(102500 + 74995 + 5000);
  });

  test("a unit whose share of the discount rounds to zero is still attributed", () => {
    const tiny: BundleEntry = { id: "tiny", pricing: { kind: "fixed_amount_off", amountMinor: 1 }, items: [{ variantId: OXY, quantity: 1 }, { variantId: LIQ, quantity: 1 }] };
    const lines = [line("L1", OXY, 102500), line("L2", LIQ, 74995)];
    expect(allocate([tiny], lines)).toHaveLength(1); // the Function discounts one line only
    const [r] = revenueAfterAdjustments(attributeOrder([tiny], lines), [], false);
    expect(r.unitsSold).toBe(2); // but both units belong to the bundle
    expect(r.grossMinor).toBe(177495);
    expect(r.discountMinor).toBe(1);
  });
});

describe("refunds and cancellations", () => {
  const lines = [line("L1", OXY, 102500), line("L2", LIQ, 74995)];
  const a = () => attributeOrder([fbt], lines);
  const base = () => revenueAfterAdjustments(a(), [], false)[0];

  test("partial refund of one unit removes its gross and its share of the discount", () => {
    const chunk = a().chunks.find((c) => c.lineId === "L2")!;
    const [r] = revenueAfterAdjustments(a(), [{ refundId: "r1", lines: [{ lineId: "L2", quantity: 1 }] }], false);
    expect(r.unitsRefunded).toBe(1);
    expect(r.netMinor).toBe(base().netMinor - (chunk.grossMinor - chunk.discountMinor));
    expect(r.grossMinor).toBe(base().grossMinor - 74995);
  });

  test("repeating the same refund event does not deduct twice", () => {
    const ev = { refundId: "r1", lines: [{ lineId: "L2", quantity: 1 }] };
    const once = revenueAfterAdjustments(a(), [ev], false)[0];
    const thrice = revenueAfterAdjustments(a(), [ev, ev, { ...ev }], false)[0];
    expect(thrice).toEqual(once);
  });

  test("two different refunds on one unit cannot refund more than was sold", () => {
    const [r] = revenueAfterAdjustments(
      a(),
      [
        { refundId: "r1", lines: [{ lineId: "L2", quantity: 1 }] },
        { refundId: "r2", lines: [{ lineId: "L2", quantity: 1 }] },
      ],
      false,
    );
    expect(r.unitsRefunded).toBe(1);
  });

  test("refunding every unit returns revenue to exactly zero with no leftover cents", () => {
    const all = lines.map((l) => ({ lineId: l.id, quantity: l.quantity }));
    const [r] = revenueAfterAdjustments(a(), [{ refundId: "r", lines: all }], false);
    expect([r.grossMinor, r.discountMinor, r.netMinor]).toEqual([0, 0, 0]);
  });

  test("odd discount splits: refunding all units of a multi-unit chunk returns the full discount", () => {
    const odd = pct("odd", 1000, [OXY, 3]); // 10% of 3 x 3.33 = 0.99 -> uneven per unit
    const ls = [line("L", OXY, 333, 3)];
    const att = attributeOrder([odd], ls);
    const d = att.chunks[0].discountMinor;
    let givenBack = 0;
    for (let k = 1; k <= 3; k++) {
      const [r] = revenueAfterAdjustments(att, [{ refundId: "r", lines: [{ lineId: "L", quantity: k }] }], false);
      givenBack = d - r.discountMinor;
    }
    expect(givenBack).toBe(d);
  });

  test("refund of a non-bundle item does not change bundle revenue", () => {
    const ls = [...lines, line("X", OTHER, 5000)];
    const att = attributeOrder([fbt], ls);
    const before = revenueAfterAdjustments(att, [], false)[0];
    const after = revenueAfterAdjustments(att, [{ refundId: "r", lines: [{ lineId: "X", quantity: 1 }] }], false)[0];
    expect(after).toEqual(before);
  });

  test("a line of 3 with 1 in the bundle: refunding 1 unit is treated as the bundle unit (conservative)", () => {
    const att = attributeOrder([fbt], [line("L1", OXY, 102500, 3), line("L2", LIQ, 74995, 1)]);
    const [r] = revenueAfterAdjustments(att, [{ refundId: "r", lines: [{ lineId: "L1", quantity: 1 }] }], false);
    expect(r.unitsRefunded).toBe(1);
    const [r2] = revenueAfterAdjustments(att, [{ refundId: "r", lines: [{ lineId: "L1", quantity: 3 }] }], false);
    expect(r2.unitsRefunded).toBe(1); // only one unit was ever a bundle unit
  });

  test("cancellation zeroes revenue and refunds on a cancelled order are ignored", () => {
    const refund = { refundId: "r1", lines: [{ lineId: "L1", quantity: 1 }] };
    for (const refunds of [[], [refund]]) {
      const [r] = revenueAfterAdjustments(a(), refunds, true);
      expect([r.sets, r.unitsSold, r.grossMinor, r.discountMinor, r.netMinor]).toEqual([0, 0, 0, 0, 0]);
    }
  });

  test("refund order and event repetition do not matter", () => {
    const e1 = { refundId: "a", lines: [{ lineId: "L1", quantity: 1 }] };
    const e2 = { refundId: "b", lines: [{ lineId: "L2", quantity: 1 }] };
    expect(revenueAfterAdjustments(a(), [e1, e2], false)).toEqual(revenueAfterAdjustments(a(), [e2, e1, e1], false));
  });
});

describe("sets after refunds", () => {
  const two = () => attributeOrder([fbt], [line("L1", OXY, 102500, 2), line("L2", LIQ, 74995, 2)]);
  const sets = (refunds: Parameters<typeof revenueAfterAdjustments>[1], a = two()) => revenueAfterAdjustments(a, refunds, false)[0].sets;

  test("no refund keeps every set", () => expect(sets([])).toBe(2));
  test("refunding one unit of one component breaks exactly one set", () => {
    expect(sets([{ refundId: "r", lines: [{ lineId: "L1", quantity: 1 }] }])).toBe(1);
  });
  test("refunding the same component twice breaks both sets", () => {
    expect(sets([{ refundId: "r", lines: [{ lineId: "L1", quantity: 2 }] }])).toBe(0);
  });
  test("refunding different components of the same set breaks one set, not two", () => {
    expect(sets([{ refundId: "r", lines: [{ lineId: "L1", quantity: 1 }, { lineId: "L2", quantity: 1 }] }])).toBe(1);
  });
  test("refunding everything leaves none", () => {
    expect(sets([{ refundId: "r", lines: [{ lineId: "L1", quantity: 2 }, { lineId: "L2", quantity: 2 }] }])).toBe(0);
  });
  test("a component needing 2 units per set: one refunded unit breaks its set", () => {
    const b = pct("dbl", 1000, [OXY, 2], [LIQ, 1]);
    const a = attributeOrder([b], [line("L1", OXY, 102500, 2), line("L2", LIQ, 74995, 1)]);
    expect(revenueAfterAdjustments(a, [{ refundId: "r", lines: [{ lineId: "L1", quantity: 1 }] }], false)[0].sets).toBe(0);
  });
  test("a stored attribution without item details keeps the purchased count (older records)", () => {
    const a = two();
    delete a.bundleItems;
    expect(sets([{ refundId: "r", lines: [{ lineId: "L1", quantity: 2 }] }], a)).toBe(2);
  });
  test("a cancelled order has no sets", () => {
    expect(revenueAfterAdjustments(two(), [], true)[0].sets).toBe(0);
  });
});

describe("currency exponents and rounding", () => {
  test("zero-decimal currency (JPY): whole-unit prices, exact distribution, refund returns the full discount", () => {
    const b = pct("jp", 1500, [OXY, 1], [LIQ, 1]);
    const a = attributeOrder([b], [line("L1", OXY, 1999), line("L2", LIQ, 3001)]);
    const [r] = revenueAfterAdjustments(a, [], false);
    expect(r.discountMinor).toBe(Math.floor((5000 * 1500) / 10000));
    const all = revenueAfterAdjustments(a, [{ refundId: "x", lines: [{ lineId: "L1", quantity: 1 }, { lineId: "L2", quantity: 1 }] }], false)[0];
    expect([all.grossMinor, all.discountMinor, all.netMinor]).toEqual([0, 0, 0]);
  });
  test("three-decimal currency (KWD): prices stay exact integers", () => {
    const b = pct("kw", 1000, [OXY, 1], [LIQ, 1]);
    const a = attributeOrder([b], [line("L1", OXY, 12345), line("L2", LIQ, 6789)]);
    const [r] = revenueAfterAdjustments(a, [], false);
    expect(r.grossMinor).toBe(19134);
    expect(r.discountMinor).toBe(1913);
    expect(Number.isInteger(r.netMinor)).toBe(true);
  });
  test("per-line discounts always sum to the bundle discount (largest-remainder, no lost cents)", () => {
    for (const [p1, p2, p3, bps] of [[333, 333, 334, 1000], [1, 1, 1, 3333], [9999, 1, 5, 777]]) {
      const b = pct("r", bps, [OXY, 1], [LIQ, 1], [OTHER, 1]);
      const a = attributeOrder([b], [line("A", OXY, p1), line("B", LIQ, p2), line("C", OTHER, p3)]);
      const total = a.chunks.reduce((s, c) => s + c.discountMinor, 0);
      expect(total).toBe(Math.floor(((p1 + p2 + p3) * bps) / 10000));
    }
  });
});
