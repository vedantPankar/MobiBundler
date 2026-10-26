import { expect, test } from "vitest";
import { previewBundle } from "../app/bundles/pricingPreview";

const items = [
  { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 },
  { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 2 },
];
const base = { name: "n", status: "draft" as const, items };
const prices = { "gid://shopify/ProductVariant/1": 2000, "gid://shopify/ProductVariant/2": 1000 };

test("percentage preview uses the shared engine", () => {
  expect(previewBundle({ ...base, pricingKind: "percentage", pricingValue: 1000 }, prices)).toEqual({
    subtotalMinor: 4000,
    discountMinor: 400,
    totalMinor: 3600,
  });
});
test("fixed preview clamps", () => {
  expect(previewBundle({ ...base, pricingKind: "fixed_amount_off", pricingValue: 99999 }, prices)).toEqual({
    subtotalMinor: 4000,
    discountMinor: 4000,
    totalMinor: 0,
  });
});
