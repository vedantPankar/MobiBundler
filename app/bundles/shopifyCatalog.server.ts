import { currencyExponent, toMinor } from "./engine";

type Vars = Record<string, unknown>;
export type CatalogAdmin = { graphql: (q: string, o?: { variables?: Vars }) => Promise<Response> };

export interface CatalogVariant {
  id: string;
  title: string;
  priceMinor: number;
  sku: string | null;
  available: number | null;
  tracksInventory: boolean;
  imageUrl: string | null;
}
export interface CatalogProduct {
  id: string;
  title: string;
  imageUrl: string | null;
  status: string;
  variants: CatalogVariant[];
}

const SEARCH = `#graphql
query SearchProductsForBundle($query: String, $first: Int!) {
  shop { currencyCode }
  products(first: $first, query: $query) {
    nodes {
      id
      title
      status
      featuredMedia { preview { image { url } } }
      variants(first: 50) {
        nodes {
          id
          title
          price
          sku
          inventoryQuantity
          inventoryItem { tracked }
          media(first: 1) { nodes { preview { image { url } } } }
        }
      }
    }
  }
}`;
const CURRENCY = `#graphql
query BundleShopCurrency {
  shop { currencyCode }
}`;
const VARIANTS = `#graphql
query BundleVariantsByIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      price
      product { id }
    }
  }
}`;

const VARIANT_DETAILS = `#graphql
query BundleVariantDetails($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      title
      price
      inventoryQuantity
      inventoryItem { tracked }
      media(first: 1) { nodes { preview { image { url } } } }
      product { id title status featuredMedia { preview { image { url } } } }
    }
  }
}`;

/* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL responses are dynamically shaped */
async function gql(admin: CatalogAdmin, q: string, variables?: Vars): Promise<any> {
  const body = (await (await admin.graphql(q, { variables })).json()) as {
    data?: any;
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

export async function searchProducts(admin: CatalogAdmin, term: string): Promise<CatalogProduct[]> {
  const clean = term.trim().replace(/[*:"\\()]/g, "");
  const d = await gql(admin, SEARCH, {
    query: clean ? `title:*${clean}* AND status:active` : "status:active",
    first: 20,
  });
  const exp = currencyExponent(d.shop.currencyCode);
  return d.products.nodes.map((p: any) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
    variants: p.variants.nodes.map((v: any) => ({
      id: v.id,
      title: v.title,
      priceMinor: toMinor(v.price, exp),
      sku: v.sku,
      available: v.inventoryItem?.tracked ? v.inventoryQuantity : null,
      tracksInventory: !!v.inventoryItem?.tracked,
      imageUrl: v.media?.nodes?.[0]?.preview?.image?.url ?? null,
    })),
  }));
}

export async function fetchShopCurrency(admin: CatalogAdmin): Promise<string> {
  return (await gql(admin, CURRENCY)).shop.currencyCode;
}

export async function fetchVariantsByIds(admin: CatalogAdmin, ids: string[]) {
  const d = await gql(admin, VARIANTS, { ids });
  const exp = currencyExponent(await fetchShopCurrency(admin));
  const out = new Map<string, { id: string; productId: string; priceMinor: number }>();
  for (const n of d.nodes) {
    if (n) out.set(n.id, { id: n.id, productId: n.product.id, priceMinor: toMinor(n.price, exp) });
  }
  return out;
}

export interface VariantDetail {
  id: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  productStatus: string;
  priceMinor: number;
  available: number | null;
  imageUrl: string | null;
}

/** For the edit screen: live details for stored variant ids. Ids Shopify no longer returns are absent from the map. */
export async function fetchVariantDetails(admin: CatalogAdmin, ids: string[]) {
  const d = await gql(admin, VARIANT_DETAILS, { ids });
  const exp = currencyExponent(await fetchShopCurrency(admin));
  const out = new Map<string, VariantDetail>();
  for (const n of d.nodes) {
    if (!n) continue;
    out.set(n.id, {
      id: n.id,
      productId: n.product.id,
      productTitle: n.product.title,
      variantTitle: n.title,
      productStatus: n.product.status,
      priceMinor: toMinor(n.price, exp),
      available: n.inventoryItem?.tracked ? n.inventoryQuantity : null,
      imageUrl: n.media?.nodes?.[0]?.preview?.image?.url ?? n.product.featuredMedia?.preview?.image?.url ?? null,
    });
  }
  return out;
}

const PRODUCT_URL = `#graphql
  query BundlerProductUrl($id: ID!) { product(id: $id) { status onlineStoreUrl } }`;

/** Public storefront URL of a product, or null when it is not published to the Online Store. */
export async function fetchProductStorefrontUrl(admin: CatalogAdmin, productId: string): Promise<string | null> {
  const d = await gql(admin, PRODUCT_URL, { id: productId });
  return d.product?.status === "ACTIVE" ? (d.product.onlineStoreUrl ?? null) : null;
}

export const __catalogQueries = { SEARCH, CURRENCY, VARIANTS, VARIANT_DETAILS, PRODUCT_URL };
