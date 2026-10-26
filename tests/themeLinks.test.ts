import { expect, test, vi } from "vitest";
import { themeEditorDeepLink } from "../app/bundles/themeLinks";
import { fetchProductStorefrontUrl, type CatalogAdmin } from "../app/bundles/shopifyCatalog.server";

const admin = (product: unknown) =>
  ({ graphql: vi.fn(async () => ({ json: async () => ({ data: { product } }) })) }) as unknown as CatalogAdmin;

test("deep link targets the bundle block on the product template", () => {
  const u = new URL(themeEditorDeepLink("shop.myshopify.com", "KEY"));
  expect(u.origin + u.pathname).toBe("https://shop.myshopify.com/admin/themes/current/editor");
  expect(u.searchParams.get("addAppBlockId")).toBe("KEY/bundle");
  expect(u.searchParams.get("template")).toBe("product");
  expect(u.searchParams.get("target")).toBe("newAppsSection");
});

test("storefront url only for active, published products", async () => {
  expect(await fetchProductStorefrontUrl(admin({ status: "ACTIVE", onlineStoreUrl: "https://s/products/a" }), "gid://shopify/Product/1")).toBe("https://s/products/a");
  expect(await fetchProductStorefrontUrl(admin({ status: "DRAFT", onlineStoreUrl: "https://s/products/a" }), "gid://shopify/Product/1")).toBeNull();
  expect(await fetchProductStorefrontUrl(admin({ status: "ACTIVE", onlineStoreUrl: null }), "gid://shopify/Product/1")).toBeNull();
  expect(await fetchProductStorefrontUrl(admin(null), "gid://shopify/Product/1")).toBeNull();
});
