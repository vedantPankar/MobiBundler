import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { searchProducts } from "../bundles/shopifyCatalog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return Response.json({ products: await searchProducts(admin, q.slice(0, 100)) });
  } catch (e) {
    // Status stays 200 so the fetcher delivers `error` to the UI instead of routing to an error boundary.
    console.error(JSON.stringify({ evt: "product_search_failed", err: (e as Error).message?.slice(0, 300) }));
    return Response.json({ products: [], error: "Could not load products from Shopify." });
  }
};
