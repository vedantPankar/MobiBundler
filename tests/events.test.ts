import { beforeEach, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { createEvents } from "../app/bundles/events.server";
import { createTestPrisma, resetTestDb } from "./testDb";

const input = {
  name: "A",
  status: "active" as const,
  pricingKind: "percentage" as const,
  pricingValue: 1000,
  items: [
    { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 },
    { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 1 },
  ],
};
let repo: ReturnType<typeof createBundleRepo>;
let ev: ReturnType<typeof createEvents>;
beforeEach(async () => {
  const p = await createTestPrisma();
  await resetTestDb(p);
  repo = createBundleRepo(p);
  ev = createEvents(repo);
});

test("records once per dedupe key, ignores unknown bundle and other shop's bundle", async () => {
  const b = await repo.create("a.myshopify.com", "USD", input);
  expect(await ev.record("a.myshopify.com", { bundleId: b.id, type: "view", dedupeKey: "k1" })).toBe("recorded");
  expect(await ev.record("a.myshopify.com", { bundleId: b.id, type: "view", dedupeKey: "k1" })).toBe("duplicate");
  expect(await ev.record("a.myshopify.com", { bundleId: "nope", type: "view", dedupeKey: "k2" })).toBe("ignored");
  expect(await ev.record("b.myshopify.com", { bundleId: b.id, type: "view", dedupeKey: "k3" })).toBe("ignored");
  expect(await ev.counts("a.myshopify.com", 30)).toEqual({ view: 1, add_to_cart: 0 });
});
test("rejects oversized or malformed keys and unknown types", async () => {
  const b = await repo.create("a.myshopify.com", "USD", input);
  expect(await ev.record("a.myshopify.com", { bundleId: b.id, type: "view", dedupeKey: "x".repeat(200) })).toBe("ignored");
  expect(await ev.record("a.myshopify.com", { bundleId: b.id, type: "view", dedupeKey: "has space" })).toBe("ignored");
  expect(await ev.record("a.myshopify.com", { bundleId: b.id, type: "purchase" as never, dedupeKey: "k" })).toBe("ignored");
});
test("counts respect the time window", async () => {
  const b = await repo.create("a.myshopify.com", "USD", input);
  await ev.record("a.myshopify.com", { bundleId: b.id, type: "add_to_cart", dedupeKey: "k1" });
  expect((await ev.counts("a.myshopify.com", 1)).add_to_cart).toBe(1);
});
