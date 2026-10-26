import { beforeAll, expect, test } from "vitest";

// The theme asset is a plain script that exposes its pure helpers on globalThis.MobiBundle.
type Core = {
  buildCartPayload: (b: unknown) => { items: { id: number; quantity: number; properties: Record<string, string> }[] };
  formatMoney: (amount: string, currency: string, locale?: string) => string;
};
let core: Core;
beforeAll(async () => {
  // @ts-expect-error plain browser script without type declarations
  await import("../extensions/bundler-storefront/assets/bundle.js");
  core = (globalThis as unknown as { MobiBundle: Core }).MobiBundle;
});

const bundle = {
  id: "bundle1",
  currencyCode: "USD",
  // Hostile extras the server could never send, but the payload builder must still ignore:
  subtotalMinor: 4000,
  totalMinor: 1,
  items: [
    { variantNumericId: "11", quantity: 1, priceMinor: 2000 },
    { variantNumericId: "22", quantity: 2, priceMinor: 1000 },
  ],
};

test("cart payload contains only variant ids, quantities and the grouping property", () => {
  const p = core.buildCartPayload(bundle);
  expect(p).toEqual({
    items: [
      { id: 11, quantity: 1, properties: { _mobi_bundle: "bundle1" } },
      { id: 22, quantity: 2, properties: { _mobi_bundle: "bundle1" } },
    ],
  });
});
test("cart payload never carries a price or discount", () => {
  const json = JSON.stringify(core.buildCartPayload(bundle));
  expect(json).not.toMatch(/price|total|discount|subtotal/i);
});
test("formatMoney falls back instead of throwing on an unknown currency", () => {
  expect(core.formatMoney("36.00", "USD", "en-US")).toContain("36.00");
  expect(core.formatMoney("36.00", "???", "en-US")).toContain("36.00");
});

test("empty state: nothing on the live storefront, an explanation only in the theme editor", () => {
  const core = (globalThis as unknown as {
    MobiBundle: { emptyMessage: (d: Record<string, string>, design: boolean) => string | null };
  }).MobiBundle;
  const labels = { labelNoBundle: "No active bundle includes this product.", labelNoTarget: "Open a product page" };
  expect(core.emptyMessage({ ...labels, productId: "1" }, false)).toBeNull();
  expect(core.emptyMessage({ ...labels, productId: "" }, false)).toBeNull();
  expect(core.emptyMessage({ ...labels, productId: "1" }, true)).toBe("No active bundle includes this product.");
  expect(core.emptyMessage({ ...labels, bundleId: "abc" }, true)).toBe("No active bundle includes this product.");
  expect(core.emptyMessage({ ...labels, productId: "" }, true)).toBe("Open a product page");
});

test("which bundle the block asks for: an explicit id wins, else the product being viewed, else nothing", () => {
  const core = (globalThis as unknown as { MobiBundle: { bundleQuery: (d: Record<string, string>) => string } }).MobiBundle;
  expect(core.bundleQuery({ bundleId: "abc", productId: "123" })).toBe("ids=abc");
  expect(core.bundleQuery({ bundleId: "", productId: "123" })).toBe("product=123");
  expect(core.bundleQuery({ bundleId: "", productId: "" })).toBe("");
  expect(core.bundleQuery({ bundleId: "a b&c=d" })).toBe("ids=a%20b%26c%3Dd"); // never injects extra parameters
});
