import { expect, test } from "vitest";
import { sanitizePayload } from "../app/bundles/capture.server";

test("capture sanitizer removes customer-identifying keys at any depth and keeps commercial data", () => {
  const out = sanitizePayload({
    id: 1,
    email: "a@b.c",
    customer: { id: 2 },
    shipping_address: { city: "X" },
    line_items: [{ variant_id: 5, quantity: 2, price: "10.00", properties: [{ name: "_mobi_bundle", value: "b1" }] }],
    discount_applications: [{ title: "MobiBundler bundles", value: "10.0", note: "x" }],
  }) as Record<string, unknown>;
  expect(out).toEqual({
    id: 1,
    line_items: [{ variant_id: 5, quantity: 2, price: "10.00", properties: [{ name: "_mobi_bundle", value: "b1" }] }],
    discount_applications: [{ title: "MobiBundler bundles", value: "10.0" }],
  });
});
