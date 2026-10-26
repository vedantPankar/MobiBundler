/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted/loosely-typed Function input */
import { expect, test } from "vitest";
import { buildResult } from "./cart_lines_discounts_generate_run";

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const line = (id: string, v: number, qty: number, amount: string) => ({
  id,
  quantity: qty,
  cost: { amountPerQuantity: { amount, currencyCode: "USD" } },
  merchandise: { __typename: "ProductVariant" as const, id: V(v) },
});
const cfg = {
  v: 1,
  bundles: [
    {
      id: "b1",
      pricing: { kind: "percentage", basisPoints: 1000 },
      items: [{ variantId: V(1), quantity: 1 }, { variantId: V(2), quantity: 1 }],
    },
  ],
};
const mk = (lines: unknown[], jsonValue: unknown, classes = ["PRODUCT"], rate = "1.0") =>
  ({
    cart: { lines },
    discount: { discountClasses: classes, metafield: jsonValue === null ? null : { jsonValue } },
    presentmentCurrencyRate: rate,
  }) as any;

test("emits fixedAmount candidates targeting cart lines", () => {
  const r = buildResult(mk([line("l1", 1, 1, "20.00"), line("l2", 2, 1, "10.00")], cfg));
  const op = r.operations[0].productDiscountsAdd!;
  expect(op.selectionStrategy).toBe("ALL");
  expect(op.candidates.map((c: any) => c.value.fixedAmount.amount)).toEqual(["2.00", "1.00"]);
  expect(op.candidates[0].targets[0].cartLine).toEqual({ id: "l1", quantity: 1 });
});
test("no operations when metafield missing or class not PRODUCT", () => {
  const lines = [line("l1", 1, 1, "20.00"), line("l2", 2, 1, "10.00")];
  expect(buildResult(mk(lines, null)).operations).toEqual([]);
  expect(buildResult(mk(lines, cfg, ["ORDER"])).operations).toEqual([]);
});
test("stale/garbage configuration yields no discount and does not throw", () => {
  const lines = [line("l1", 1, 1, "20.00"), line("l2", 2, 1, "10.00")];
  for (const bad of [{ v: 99, bundles: cfg.bundles }, "oops", 42, { v: 1, bundles: [{ nope: true }] }]) {
    expect(buildResult(mk(lines, bad)).operations).toEqual([]);
  }
});
test("partial bundle receives nothing", () => {
  expect(buildResult(mk([line("l1", 1, 1, "20.00")], cfg)).operations).toEqual([]);
});
test("custom (non-variant) merchandise is ignored", () => {
  const custom = { id: "c", quantity: 1, cost: { amountPerQuantity: { amount: "5.00", currencyCode: "USD" } }, merchandise: { __typename: "CustomProduct" } };
  expect(buildResult(mk([custom, line("l1", 1, 1, "20.00")], cfg)).operations).toEqual([]);
});
test("fixed_amount_off converts with presentment rate", () => {
  const c = {
    v: 1,
    bundles: [
      {
        id: "f",
        pricing: { kind: "fixed_amount_off", amountMinor: 500 },
        items: [{ variantId: V(1), quantity: 1 }, { variantId: V(2), quantity: 1 }],
      },
    ],
  };
  const r = buildResult(mk([line("l1", 1, 1, "20.00"), line("l2", 2, 1, "10.00")], c, ["PRODUCT"], "2.0"));
  const sum = r.operations[0].productDiscountsAdd!.candidates.reduce(
    (s: number, x: any) => s + Number(x.value.fixedAmount.amount),
    0,
  );
  expect(sum).toBeCloseTo(10.0, 2);
});
test("two sets and extra units: only complete sets targeted", () => {
  const r = buildResult(mk([line("l1", 1, 3, "10.00"), line("l2", 2, 2, "10.00")], cfg));
  const c = r.operations[0].productDiscountsAdd!.candidates as any[];
  expect(c.find((x) => x.targets[0].cartLine.id === "l1").targets[0].cartLine.quantity).toBe(2);
});

test("every candidate carries the shared message that revenue tracking matches on orders", async () => {
  const { BUNDLE_DISCOUNT_MESSAGE } = await import("./engine");
  const r = buildResult(mk([line("l1", 1, 1, "20.00"), line("l2", 2, 1, "10.00")], cfg));
  const messages = r.operations[0].productDiscountsAdd!.candidates.map((c: any) => c.message);
  expect(messages).toEqual([BUNDLE_DISCOUNT_MESSAGE, BUNDLE_DISCOUNT_MESSAGE]);
  expect(BUNDLE_DISCOUNT_MESSAGE).toBe("Bundle discount"); // the title seen on real order #1001
});
