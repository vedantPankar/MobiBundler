import type { LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { bundleRepo } from "../bundles/index.server";
import { getPublicBundles } from "../bundles/publicBundles.server";

// Reached through the storefront app proxy (/apps/mobi-bundler/bundles). appProxy() verifies Shopify's
// signature and rejects unsigned requests; the shop comes only from the verified request.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return Response.json({ bundles: [] });
  const params = new URL(request.url).searchParams;
  const product = params.get("product") ?? "";
  // No explicit ids: show the newest active bundle that contains the product being viewed.
  const ids = /^\d{1,20}$/.test(product)
    ? await bundleRepo.activeIdsForProduct(session.shop, product, 1)
    : (params.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s))
        .slice(0, 10);
  if (ids.length === 0) return Response.json({ bundles: [] });
  try {
    const { admin } = await unauthenticated.admin(session.shop);
    const bundles = await getPublicBundles({ shop: session.shop, ids, repo: bundleRepo, admin });
    return Response.json({ bundles }, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch {
    return Response.json({ bundles: [], error: "unavailable" }, { status: 502 });
  }
};
