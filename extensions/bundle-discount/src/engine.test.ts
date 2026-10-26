import { describe, expect, test } from "vitest";
import {
  allocate,
  distribute,
  fromMinor,
  toMinor,
  currencyExponent,
  type BundleEntry,
  type CartLineInput,
} from "./engine";

const L = (id: string, variantId: string, quantity: number, unitPriceMinor: number): CartLineInput => ({
  id,
  variantId,
  quantity,
  unitPriceMinor,
});
const pct = (id: string, bps: number, items: [string, number][]): BundleEntry => ({
  id,
  pricing: { kind: "percentage", basisPoints: bps },
  items: items.map(([variantId, quantity]) => ({ variantId, quantity })),
});
const fix = (id: string, amountMinor: number, items: [string, number][]): BundleEntry => ({
  id,
  pricing: { kind: "fixed_amount_off", amountMinor },
  items: items.map(([variantId, quantity]) => ({ variantId, quantity })),
});
const total = (a: { discountMinor: number }[]) => a.reduce((s, x) => s + x.discountMinor, 0);

describe("distribute", () => {
  test("sums exactly, largest remainder, stable", () => {
    expect(distribute(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(distribute(0, [5, 5])).toEqual([0, 0]);
    expect(distribute(7, [0, 0])).toEqual([0, 0]);
  });
});

describe("money helpers", () => {
  test("string <-> minor without floats", () => {
    expect(toMinor("19.99", 2)).toBe(1999);
    expect(toMinor("20", 2)).toBe(2000);
    expect(toMinor("1500", 0)).toBe(1500);
    expect(fromMinor(1999, 2)).toBe("19.99");
    expect(fromMinor(5, 2)).toBe("0.05");
    expect(fromMinor(1500, 0)).toBe("1500");
    expect(fromMinor(1234, 3)).toBe("1.234");
  });
  test("currency exponents", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });
});

describe("fixed bundle, percentage", () => {
  const b = pct("b1", 1000, [["A", 1], ["B", 1]]);
  test("applies when all components present", () => {
    const r = allocate([b], [L("l1", "A", 1, 2000), L("l2", "B", 1, 1000)]);
    expect(total(r)).toBe(300);
    expect(r.find((x) => x.lineId === "l1")!.discountMinor).toBe(200);
  });
  test("no discount when a component is missing", () => {
    expect(allocate([b], [L("l1", "A", 1, 2000)])).toEqual([]);
  });
  test("extra units stay full price", () => {
    const r = allocate([b], [L("l1", "A", 3, 1000), L("l2", "B", 1, 1000)]);
    expect(r.find((x) => x.lineId === "l1")!.quantity).toBe(1);
    expect(total(r)).toBe(200);
  });
  test("two complete sets", () => {
    const r = allocate([b], [L("l1", "A", 2, 1000), L("l2", "B", 2, 1000)]);
    expect(total(r)).toBe(400);
  });
  test("quantity changes: 2A+1B => 1 set; remove B => none", () => {
    expect(total(allocate([b], [L("l1", "A", 2, 1000), L("l2", "B", 1, 1000)]))).toBe(200);
    expect(allocate([b], [L("l1", "A", 2, 1000)])).toEqual([]);
  });
  test("component quantity > 1", () => {
    const b2 = pct("b2", 5000, [["A", 2], ["B", 1]]);
    expect(allocate([b2], [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000)])).toEqual([]);
    expect(total(allocate([b2], [L("l1", "A", 2, 1000), L("l2", "B", 1, 1000)]))).toBe(1500);
  });
  test("duplicate product on two lines: units pooled, higher price consumed first", () => {
    const r = allocate([b], [L("l1", "A", 1, 1000), L("l2", "A", 1, 3000), L("l3", "B", 1, 1000)]);
    expect(r.map((x) => x.lineId).sort()).toEqual(["l2", "l3"]);
    expect(total(r)).toBe(400);
  });
});

describe("fixed bundle, fixed amount off", () => {
  test("fixed amount per set, clamped to subtotal", () => {
    const b = fix("f1", 500, [["A", 1], ["B", 1]]);
    expect(total(allocate([b], [L("l1", "A", 1, 2000), L("l2", "B", 1, 1000)]))).toBe(500);
    expect(total(allocate([b], [L("l1", "A", 2, 2000), L("l2", "B", 2, 1000)]))).toBe(1000);
    expect(total(allocate([b], [L("l1", "A", 1, 100), L("l2", "B", 1, 100)]))).toBe(200);
  });
  test("distribution sums exactly with odd amounts", () => {
    const b = fix("f1", 100, [["A", 1], ["B", 1], ["C", 1]]);
    const r = allocate([b], [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000), L("l3", "C", 1, 1000)]);
    expect(total(r)).toBe(100);
  });
});

describe("multiple and overlapping bundles", () => {
  test("a unit is never discounted twice", () => {
    const b1 = pct("b1", 1000, [["A", 1], ["B", 1]]);
    const b2 = pct("b2", 2000, [["A", 1], ["C", 1]]);
    const lines = [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000), L("l3", "C", 1, 1000)];
    const r = allocate([b1, b2], lines);
    expect(r.filter((x) => x.lineId === "l1")).toHaveLength(1);
    expect(r.map((x) => x.bundleId).sort()).toEqual(["b2", "b2"]); // higher saving wins; B has no partner left
  });
  test("two disjoint bundles both apply", () => {
    const b1 = pct("b1", 1000, [["A", 1], ["B", 1]]);
    const b2 = pct("b2", 1000, [["C", 1], ["D", 1]]);
    const lines = ["A", "B", "C", "D"].map((v, i) => L(`l${i}`, v, 1, 1000));
    expect(total(allocate([b1, b2], lines))).toBe(400);
  });
  test("deterministic regardless of input order", () => {
    const bs = [pct("b1", 1000, [["A", 1], ["B", 1]]), pct("b2", 1000, [["A", 1], ["C", 1]])];
    const lines = [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000), L("l3", "C", 1, 1000)];
    const a = allocate(bs, lines);
    const c = allocate([...bs].reverse(), [...lines].reverse());
    expect(c).toEqual(a);
  });
});

describe("robustness", () => {
  test("unknown pricing kind is skipped", () => {
    const b: BundleEntry = {
      id: "x",
      pricing: { kind: "fixed_price", totalMinor: 100 },
      items: [{ variantId: "A", quantity: 1 }, { variantId: "B", quantity: 1 }],
    };
    expect(allocate([b], [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000)])).toEqual([]);
  });
  test("invalid entries are skipped (empty, qty<1, duplicate variants)", () => {
    const lines = [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000)];
    expect(allocate([pct("e", 1000, [])], lines)).toEqual([]);
    expect(allocate([pct("q", 1000, [["A", 0], ["B", 1]])], lines)).toEqual([]);
    expect(allocate([pct("d", 1000, [["A", 1], ["A", 1]])], lines)).toEqual([]);
  });
  test("out-of-range pricing values are skipped", () => {
    const lines = [L("l1", "A", 1, 1000), L("l2", "B", 1, 1000)];
    expect(allocate([pct("p", 10001, [["A", 1], ["B", 1]])], lines)).toEqual([]);
    expect(allocate([pct("z", 0, [["A", 1], ["B", 1]])], lines)).toEqual([]);
    expect(allocate([fix("n", -5, [["A", 1], ["B", 1]])], lines)).toEqual([]);
    expect(allocate([fix("f", 1.5, [["A", 1], ["B", 1]])], lines)).toEqual([]);
  });
  test("200 lines stay fast", () => {
    const lines = Array.from({ length: 200 }, (_, i) => L(`l${i}`, `V${i % 20}`, 1, 1000 + i));
    const bs = Array.from({ length: 50 }, (_, i) =>
      pct(`b${i}`, 1000, [[`V${i % 20}`, 1], [`V${(i + 1) % 20}`, 1]]),
    );
    const t = performance.now();
    allocate(bs, lines);
    expect(performance.now() - t).toBeLessThan(200);
  });
});
