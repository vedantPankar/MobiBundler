import { expect, test } from "vitest";
import { parseSharedConfig } from "./config";

test("accepts v1 config", () => {
  const raw = {
    v: 1,
    bundles: [
      {
        id: "b",
        pricing: { kind: "percentage", basisPoints: 1000 },
        items: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }],
      },
    ],
  };
  expect(parseSharedConfig(raw)).toHaveLength(1);
});
test.each([null, undefined, "x", { v: 2, bundles: [] }, { v: 1 }, { v: 1, bundles: "no" }])(
  "rejects/empties %j",
  (raw) => {
    expect(parseSharedConfig(raw as unknown)).toEqual([]);
  },
);
test("drops malformed bundle entries but keeps good ones", () => {
  const good = {
    id: "g",
    pricing: { kind: "percentage", basisPoints: 500 },
    items: [{ variantId: "a", quantity: 1 }],
  };
  expect(parseSharedConfig({ v: 1, bundles: [good, { id: 5 }, null] })).toEqual([good]);
});
