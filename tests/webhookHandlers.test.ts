import { beforeEach, expect, test } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { handleShopErase, handleProductDeleted } from "../app/bundles/webhookHandlers.server";
import { createTestPrisma, resetTestDb } from "./testDb";

const input = (name: string) => ({
  name,
  status: "active" as const,
  pricingKind: "percentage" as const,
  pricingValue: 1000,
  items: [
    { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1 },
    { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quantity: 1 },
  ],
});
let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => {
  const prisma = await createTestPrisma();
  await resetTestDb(prisma);
  repo = createBundleRepo(prisma);
});

test("shop erase removes only that shop's data and is replay-safe", async () => {
  await repo.create("a.myshopify.com", "USD", input("A"));
  await repo.create("b.myshopify.com", "USD", input("B"));
  await repo.recordEvent("a.myshopify.com", "x", "view", "k");
  await handleShopErase({ shop: "a.myshopify.com", repo });
  await handleShopErase({ shop: "a.myshopify.com", repo });
  expect(await repo.list("a.myshopify.com")).toEqual([]);
  expect(await repo.eventCounts("a.myshopify.com")).toEqual({ view: 0, add_to_cart: 0 });
  expect(await repo.list("b.myshopify.com")).toHaveLength(1);
});
test("deleted product pauses affected active bundles of that shop only, idempotently", async () => {
  const a = await repo.create("a.myshopify.com", "USD", input("A"));
  const b = await repo.create("b.myshopify.com", "USD", input("B"));
  const del = { shop: "a.myshopify.com", productId: "gid://shopify/Product/1", repo };
  expect((await handleProductDeleted(del)).affected).toBe(1);
  const got = (await repo.get("a.myshopify.com", a.id))!;
  expect(got.status).toBe("paused");
  expect(got.syncError).toMatch(/deleted/i);
  expect((await repo.get("b.myshopify.com", b.id))!.status).toBe("active");
  expect((await handleProductDeleted(del)).affected).toBe(0);
});
