import type { ActionFunctionArgs, HeadersArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { bundleRepo, syncForShop } from "../bundles/index.server";
import { saveBundle } from "../bundles/save.server";
import { fetchShopCurrency, fetchVariantDetails } from "../bundles/shopifyCatalog.server";
import { BundleForm, type FormItem } from "../bundles/BundleForm";
import { parsePrefill } from "../bundles/suggestions.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const currencyCode = await fetchShopCurrency(admin);

  // A suggestion links here with ?variants=1,2&discount=10. Nothing is created: the merchant reviews the draft.
  const prefill = parsePrefill(new URL(request.url).searchParams);
  if (!prefill) return { currencyCode, prefill: null };
  const live = await fetchVariantDetails(admin, prefill.variantGids);
  const items: FormItem[] = prefill.variantGids.flatMap((id) => {
    const d = live.get(id);
    if (!d) return [];
    return [{
      productId: d.productId,
      variantId: id,
      quantity: 1,
      label: d.variantTitle === "Default Title" ? d.productTitle : `${d.productTitle} – ${d.variantTitle}`,
      priceMinor: d.priceMinor,
      available: d.available,
    }];
  });
  if (items.length < 2) return { currencyCode, prefill: null };
  return { currencyCode, prefill: { items, discountBps: prefill.discountBps, name: items.map((i) => i.label).join(" + ").slice(0, 80) } };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();
  const result = await saveBundle(
    { shop: session.shop, admin, repo: bundleRepo, sync: () => syncForShop(session.shop, admin) },
    body,
  );
  if (result.ok && !result.syncMessage) throw redirect(`/app/bundles/${result.bundleId}`);
  return result;
};

export default function NewBundle() {
  const { currencyCode, prefill } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Create bundle">
      <BundleForm
        key={prefill?.name ?? "blank"}
        currencyCode={currencyCode}
        sharedVariantWarning={false}
        initial={{
          name: prefill?.name ?? "",
          description: "",
          status: "draft",
          pricingKind: "percentage",
          pricingValue: prefill?.discountBps ?? 0,
          buttonLabel: "",
          showSavings: true,
          items: prefill?.items ?? [],
        }}
      />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: HeadersArgs) => boundary.headers(headersArgs);
