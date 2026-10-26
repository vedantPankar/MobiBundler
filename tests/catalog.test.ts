import { expect, test, vi } from "vitest";
import { searchProducts, type CatalogAdmin } from "../app/bundles/shopifyCatalog.server";

// Offline fake of the Admin client: proves parsing/escaping only, NOT live Shopify behavior.
const admin = (data: unknown) =>
  ({ graphql: vi.fn(async () => ({ json: async () => ({ data }) })) }) as unknown as CatalogAdmin & {
    graphql: ReturnType<typeof vi.fn>;
  };

const data = {
  shop: { currencyCode: "USD" },
  products: {
    nodes: [
      {
        id: "gid://shopify/Product/1",
        title: "Tee",
        status: "ACTIVE",
        featuredMedia: { preview: { image: { url: "https://cdn/x.png" } } },
        variants: {
          nodes: [
            { id: "gid://shopify/ProductVariant/1", title: "S", price: "19.99", sku: "T-S", inventoryQuantity: 4, inventoryItem: { tracked: true }, media: { nodes: [] } },
            { id: "gid://shopify/ProductVariant/2", title: "M", price: "20.00", sku: null, inventoryQuantity: 0, inventoryItem: { tracked: false }, media: { nodes: [] } },
          ],
        },
      },
    ],
  },
};

test("maps products, converts prices to minor units, hides untracked stock", async () => {
  const r = await searchProducts(admin(data), "tee");
  expect(r[0].variants[0]).toMatchObject({ priceMinor: 1999, available: 4, tracksInventory: true });
  expect(r[0].imageUrl).toBe("https://cdn/x.png");
  expect(r[0].variants[1]).toMatchObject({ priceMinor: 2000, available: null, tracksInventory: false });
});
test("search term is stripped of query operators", async () => {
  const a = admin(data);
  await searchProducts(a, 'x" OR status:draft *');
  const vars = (a.graphql.mock.calls[0] as unknown[])[1] as { variables: { query: string } };
  expect(vars.variables.query).not.toMatch(/["*:]\s*OR|status:draft/);
  expect(vars.variables.query).toContain("status:active");
});
test("empty term lists active products", async () => {
  const a = admin(data);
  await searchProducts(a, "  ");
  const vars = (a.graphql.mock.calls[0] as unknown[])[1] as { variables: { query: string } };
  expect(vars.variables.query).toBe("status:active");
});
