import { expect, test } from "vitest";
import { allocate, fromMinor, toMinor, type BundleEntry, type CartLineInput } from "../app/bundles/engine";

// Replays the real order #1001 inputs observed on mobibundler.myshopify.com (bundle "FBT", 10% off, two
// products). The expected figures are Shopify's recorded per-line discounts, taken from the storefront cart, NOT
// computed by this test. Revenue attribution depends on allocate() reproducing them.
const OXYGEN = "gid://shopify/ProductVariant/50798419509434";
const LIQUID = "gid://shopify/ProductVariant/50798419411130";
const fbt: BundleEntry = {
  id: "cmvi8ulin00008o6efg7fzwk2",
  pricing: { kind: "percentage", basisPoints: 1000 },
  items: [
    { variantId: OXYGEN, quantity: 1 },
    { variantId: LIQUID, quantity: 1 },
  ],
};
const line = (id: string, variantId: string, price: string): CartLineInput => ({
  id,
  variantId,
  quantity: 1,
  unitPriceMinor: toMinor(price, 2),
});

test("order #1001: replay reproduces Shopify's recorded per-line bundle discounts", () => {
  const out = allocate([fbt], [line("L1", OXYGEN, "1025.00"), line("L2", LIQUID, "749.95")]);
  const byLine = Object.fromEntries(out.map((a) => [a.lineId, fromMinor(a.discountMinor, 2)]));
  expect(byLine).toEqual({ L1: "102.50", L2: "74.99" }); // recorded by Shopify
  expect(fromMinor(out.reduce((s, a) => s + a.discountMinor, 0), 2)).toBe("177.49"); // recorded total discount
  // 1,025.00 + 749.95 - 177.49 = 1,597.46, the order's discounted subtotal
  expect(fromMinor(102500 + 74995 - 17749, 2)).toBe("1597.46");
});

test("same cart in either line order gives the same allocation", () => {
  const a = allocate([fbt], [line("L1", OXYGEN, "1025.00"), line("L2", LIQUID, "749.95")]);
  const b = allocate([fbt], [line("L2", LIQUID, "749.95"), line("L1", OXYGEN, "1025.00")]);
  const key = (x: typeof a) => x.map((r) => `${r.lineId}:${r.discountMinor}`).sort();
  expect(key(a)).toEqual(key(b));
});

test("one product missing: no discount, so no bundle revenue to attribute", () => {
  expect(allocate([fbt], [line("L1", OXYGEN, "1025.00")])).toEqual([]);
});
