import type { ActionFunctionArgs, HeadersArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { redirect, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { bundleRepo, revenueRepo, syncForShop } from "../bundles/index.server";
import { BundleRevenuePanel } from "../bundles/BundleRevenuePanel";
import { splitByCurrency, summarizeRevenue } from "../bundles/revenueSummary";
import { saveBundle } from "../bundles/save.server";
import { fetchProductStorefrontUrl, fetchVariantDetails } from "../bundles/shopifyCatalog.server";
import { BundleForm, type FormItem } from "../bundles/BundleForm";
import { themeEditorDeepLink } from "../bundles/themeLinks";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // shop comes only from the session: another shop's id is indistinguishable from a missing one.
  const bundle = await bundleRepo.get(session.shop, params.id ?? "");
  if (!bundle) throw new Response("Not found", { status: 404 });

  const ids = bundle.items.map((i) => i.variantId);
  const live = await fetchVariantDetails(admin, ids);
  const items: FormItem[] = bundle.items.map((i) => {
    const d = live.get(i.variantId);
    return {
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
      label: d
        ? d.variantTitle === "Default Title"
          ? d.productTitle
          : `${d.productTitle} – ${d.variantTitle}`
        : "Unavailable product",
      priceMinor: d?.priceMinor ?? 0,
      available: d?.available ?? null,
      imageUrl: d?.imageUrl ?? null,
      missing: !d,
    };
  });
  const shared = await bundleRepo.variantsInUse(session.shop, ids, bundle.id);
  // A storefront link is a convenience: a failed lookup must not break the edit screen.
  const firstProductId = bundle.items[0]?.productId;
  const storefrontUrl = firstProductId
    ? await fetchProductStorefrontUrl(admin, firstProductId).catch(() => null)
    : null;
  // Read-only: the dashboard owns syncing. The panel only reports what has been synced.
  const days = 30;
  const [allRows, syncState] = await Promise.all([
    revenueRepo.rows(session.shop, new Date(Date.now() - days * 86_400_000)),
    revenueRepo.getState(session.shop),
  ]);
  const { rows } = splitByCurrency(allRows, bundle.currencyCode);
  const revenue = summarizeRevenue(rows.filter((r) => r.bundleId === bundle.id)).total;
  return {
    revenue: {
      days,
      totals: revenue,
      sync: { lastSyncedAt: syncState?.lastSyncedAt?.toISOString() ?? null, error: syncState?.lastError ?? null },
    },
    id: bundle.id,
    status: bundle.status,
    storefrontUrl,
    themeEditorUrl: themeEditorDeepLink(session.shop, process.env.SHOPIFY_API_KEY ?? ""),
    version: bundle.version,
    currencyCode: bundle.currencyCode,
    syncError: bundle.syncStatus === "error" ? bundle.syncError : null,
    sharedVariantWarning: shared.length > 0,
    initial: {
      name: bundle.name,
      description: bundle.description ?? "",
      status: bundle.status,
      pricingKind: bundle.pricingKind,
      pricingValue: bundle.pricingValue,
      buttonLabel: bundle.buttonLabel ?? "",
      showSavings: bundle.showSavings,
      items,
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const sync = () => syncForShop(session.shop, admin);
  const type = request.headers.get("content-type") ?? "";

  if (!type.includes("application/json")) {
    const form = await request.formData();
    if (form.get("intent") === "resync") {
      if (!(await bundleRepo.get(session.shop, params.id ?? ""))) throw new Response("Not found", { status: 404 });
      const r = await sync();
      return r.status === "error"
        ? { ok: true as const, bundleId: params.id ?? "", syncMessage: r.message }
        : { ok: true as const, bundleId: params.id ?? "" };
    }
    throw new Response("Bad request", { status: 400 });
  }

  const { _version, ...body } = (await request.json()) as { _version?: number } & Record<string, unknown>;
  const result = await saveBundle(
    { shop: session.shop, admin, repo: bundleRepo, sync, id: params.id, expectedVersion: _version },
    body,
  );
  if (result.ok && !result.syncMessage) throw redirect("/app/bundles");
  return result;
};

export default function EditBundle() {
  const data = useLoaderData<typeof loader>();
  const [copied, setCopied] = useState(false);
  const copyId = () => {
    navigator.clipboard
      ?.writeText(data.id)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <s-page heading={data.initial.name || "Edit bundle"}>
      <s-section heading="Show on your storefront">
        <s-stack gap="base">
          {data.status !== "active" && (
            <s-banner tone="warning">
              This bundle is {data.status}. Set the status to Active and save, or it stays hidden on the storefront.
            </s-banner>
          )}
          <s-text-field label="Bundle ID" readOnly value={data.id} details="Paste this into the Bundle block's Bundle ID setting." />
          <s-stack direction="inline" gap="base">
            <s-button onClick={copyId}>{copied ? "Copied" : "Copy bundle ID"}</s-button>
            <s-button variant="primary" href={data.themeEditorUrl} target="_blank">
              Add to theme
            </s-button>
            {data.storefrontUrl ? (
              <s-button href={data.storefrontUrl} target="_blank">
                View on storefront
              </s-button>
            ) : (
              <s-text>Storefront link unavailable: the first product is not published to the Online Store.</s-text>
            )}
          </s-stack>
          <s-paragraph>
            Add to theme opens the theme editor with the Bundle block ready. Leave the ID empty to show it automatically on its products, or paste the ID to pin it. Save the theme, then use View
            on storefront.
          </s-paragraph>
        </s-stack>
      </s-section>
      <BundleRevenuePanel days={data.revenue.days} currency={data.currencyCode} totals={data.revenue.totals} sync={data.revenue.sync} />
      <BundleForm
        key={`${data.id}:${data.version}`}
        currencyCode={data.currencyCode}
        version={data.version}
        syncError={data.syncError}
        sharedVariantWarning={data.sharedVariantWarning}
        initial={data.initial}
        storefrontUrl={data.storefrontUrl}
      />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: HeadersArgs) => boundary.headers(headersArgs);
