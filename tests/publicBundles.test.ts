import { beforeEach, expect, test, vi } from "vitest";
import { createBundleRepo } from "../app/bundles/repo.server";
import { getPublicBundles } from "../app/bundles/publicBundles.server";
import type { CatalogAdmin } from "../app/bundles/shopifyCatalog.server";
import { createTestPrisma, resetTestDb } from "./testDb";

const A = "a.myshopify.com";
const input = (name: string, status: "active" | "draft" | "archived" = "active") => ({
  name,
  status,
  pricingKind: "percentage" as const,
  pricingValue: 1000,
  items: [
    { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/11", quantity: 1 },
    { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/22", quantity: 2 },
  ],
});

// Offline fake: proves our mapping/filtering only, NOT live Shopify behavior.
const admin = (missing: string[] = [], stock: number | null = null) =>
  ({
    graphql: vi.fn(async (q: string) => ({
      json: async () =>
        q.includes("BundleShopCurrency")
          ? { data: { shop: { currencyCode: "USD" } } }
          : {
              data: {
                nodes: ["11", "22"]
                  .filter((n) => !missing.includes(n))
                  .map((n) => ({
                    id: `gid://shopify/ProductVariant/${n}`,
                    title: "Default Title",
                    price: n === "11" ? "20.00" : "10.00",
                    inventoryQuantity: stock ?? 5,
                    inventoryItem: { tracked: stock !== null },
                    media: { nodes: [] },
                    product: { id: `gid://shopify/Product/${n === "11" ? 1 : 2}`, title: `P${n}`, status: "ACTIVE" },
                  })),
              },
            },
    })),
  }) as unknown as CatalogAdmin;

let repo: ReturnType<typeof createBundleRepo>;
beforeEach(async () => {
  const p = await createTestPrisma();
  await resetTestDb(p);
  repo = createBundleRepo(p);
});

test("returns only active bundles of this shop, with engine-consistent totals", async () => {
  const live = await repo.create(A, "USD", input("Live"));
  const draft = await repo.create(A, "USD", input("Draft", "draft"));
  const other = await repo.create("b.myshopify.com", "USD", input("Other"));
  const r = await getPublicBundles({ shop: A, ids: [live.id, draft.id, other.id, "nope"], repo, admin: admin() });
  expect(r.map((b) => b.id)).toEqual([live.id]);
  // 20.00 + 2 x 10.00 = 40.00; 10% off = 4.00
  expect(r[0]).toMatchObject({ subtotal: "40.00", discount: "4.00", total: "36.00", currencyCode: "USD" });
  expect(r[0].items.map((i) => i.variantNumericId)).toEqual(["11", "22"]);
});
test("omits a bundle whose component no longer exists", async () => {
  const live = await repo.create(A, "USD", input("Live"));
  expect(await getPublicBundles({ shop: A, ids: [live.id], repo, admin: admin(["22"]) })).toEqual([]);
});
test("flags out-of-stock components without hiding the bundle", async () => {
  const live = await repo.create(A, "USD", input("Live"));
  const [b] = await getPublicBundles({ shop: A, ids: [live.id], repo, admin: admin([], 0) });
  expect(b.items.every((i) => !i.inStock)).toBe(true);
});
test("never exposes shop or internal fields", async () => {
  const live = await repo.create(A, "USD", input("Live"));
  const [b] = await getPublicBundles({ shop: A, ids: [live.id], repo, admin: admin() });
  expect(JSON.stringify(b)).not.toContain("myshopify");
  expect(Object.keys(b)).not.toContain("shop");
  expect(Object.keys(b)).not.toContain("syncError");
});
