import { expect, test } from "vitest";
import { parseBundleInput } from "../app/bundles/validation";

const ok = {
  name: "Duo",
  status: "draft",
  pricingKind: "percentage",
  pricingValue: 1000,
  items: [
    { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 },
    { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 2 },
  ],
};

test("accepts valid input", () => expect(parseBundleInput(ok).items).toHaveLength(2));
test("needs >= 2 distinct variants", () => {
  expect(() => parseBundleInput({ ...ok, items: [ok.items[0]] })).toThrow();
  expect(() => parseBundleInput({ ...ok, items: [ok.items[0], ok.items[0]] })).toThrow();
});
test("max 10 components", () => {
  const items = Array.from({ length: 11 }, (_, i) => ({
    productId: `gid://shopify/Product/${i}`,
    variantId: `gid://shopify/ProductVariant/${i}`,
    quantity: 1,
  }));
  expect(() => parseBundleInput({ ...ok, items })).toThrow();
});
test("pricing bounds", () => {
  expect(() => parseBundleInput({ ...ok, pricingValue: 0 })).toThrow();
  expect(() => parseBundleInput({ ...ok, pricingValue: 10001 })).toThrow();
  expect(() => parseBundleInput({ ...ok, pricingKind: "fixed_amount_off", pricingValue: 0 })).toThrow();
  expect(parseBundleInput({ ...ok, pricingKind: "fixed_amount_off", pricingValue: 500 }).pricingValue).toBe(500);
});
test("rejects bad ids, quantity, status, name", () => {
  expect(() => parseBundleInput({ ...ok, items: [{ ...ok.items[0], variantId: "x" }, ok.items[1]] })).toThrow();
  expect(() => parseBundleInput({ ...ok, items: [{ ...ok.items[0], quantity: 0 }, ok.items[1]] })).toThrow();
  expect(() => parseBundleInput({ ...ok, status: "live" })).toThrow();
  expect(() => parseBundleInput({ ...ok, name: " " })).toThrow();
});
