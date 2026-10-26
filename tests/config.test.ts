import { expect, test } from "vitest";
import { buildSharedConfig, serializeSharedConfig, MAX_CONFIG_BYTES, MAX_ACTIVE_BUNDLES } from "../app/bundles/config";
import type { StoredBundle } from "../app/bundles/types";

const mk = (id: string, n = 2): StoredBundle => ({
  id,
  shop: "a.myshopify.com",
  name: id,
  description: null,
  type: "fixed",
  status: "active",
  pricingKind: "percentage",
  pricingValue: 1000,
  currencyCode: "USD",
  buttonLabel: null,
  showSavings: true,
  syncStatus: "pending",
  syncError: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: Array.from({ length: n }, (_, i) => ({
    id: `${id}${i}`,
    productId: `gid://shopify/Product/${i}`,
    variantId: `gid://shopify/ProductVariant/${i}`,
    quantity: 1,
    position: i,
  })),
});

test("builds v1 entries with only needed fields", () => {
  expect(buildSharedConfig([mk("b1")])).toEqual({
    v: 1,
    bundles: [
      {
        id: "b1",
        pricing: { kind: "percentage", basisPoints: 1000 },
        items: [
          { variantId: "gid://shopify/ProductVariant/0", quantity: 1 },
          { variantId: "gid://shopify/ProductVariant/1", quantity: 1 },
        ],
      },
    ],
  });
});
test("fixed amount maps to amountMinor", () => {
  const b = { ...mk("f"), pricingKind: "fixed_amount_off" as const, pricingValue: 500 };
  expect(buildSharedConfig([b]).bundles[0].pricing).toEqual({ kind: "fixed_amount_off", amountMinor: 500 });
});
test("hash is stable and order-independent", () => {
  const a = serializeSharedConfig([mk("b1"), mk("b2")]);
  const b = serializeSharedConfig([mk("b2"), mk("b1")]);
  expect(a.hash).toBe(b.hash);
});
test("rejects configs over byte budget", () => {
  const big = Array.from({ length: MAX_ACTIVE_BUNDLES }, (_, i) =>
    mk(`bundle-${"x".repeat(4000)}-${i}`, 10),
  );
  expect(() => serializeSharedConfig(big)).toThrow(/64/);
  expect(MAX_CONFIG_BYTES).toBe(65536);
});
test("rejects more active bundles than the instruction budget allows", () => {
  const many = Array.from({ length: MAX_ACTIVE_BUNDLES + 1 }, (_, i) => mk(`b${i}`));
  expect(() => serializeSharedConfig(many)).toThrow(/limit is 20/);
});
test("config never contains shop, names, or prices", () => {
  const { json } = serializeSharedConfig([mk("b1")]);
  expect(json).not.toContain("myshopify");
  expect(json).not.toContain("USD");
});
