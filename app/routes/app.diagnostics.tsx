import type { ActionFunctionArgs, HeadersArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { bundleRepo, syncForShop } from "../bundles/index.server";
import { runDiagnostics } from "../bundles/diagnostics.server";
import { adminDiscountGateway } from "../bundles/shopifyDiscount.server";
import { fetchVariantsByIds } from "../bundles/shopifyCatalog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    const items = await runDiagnostics({
      shop: session.shop,
      repo: bundleRepo,
      prisma,
      gateway: adminDiscountGateway(admin),
      fetchVariants: (ids) => fetchVariantsByIds(admin, ids),
      grantedScopes: (session.scope ?? "").split(",").map((s) => s.trim()),
    });
    return { items, failed: false as const };
  } catch {
    return { items: [], failed: true as const };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "resync") return { ok: false, message: "Unknown action." };
  const r = await syncForShop(session.shop, admin);
  return r.status === "error"
    ? { ok: false, message: `Sync failed: ${r.message}` }
    : { ok: true, message: `Sync complete (${r.status}).` };
};

const TONE = { ok: "success", warning: "warning", critical: "critical" } as const;

export default function Diagnostics() {
  const { items, failed } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading="Diagnostics">
      {result && <s-banner tone={result.ok ? "success" : "critical"} dismissible>{result.message}</s-banner>}
      {failed && (
        <s-banner tone="critical" heading="Could not run diagnostics">
          <s-paragraph>Shopify could not be reached. Reload the page to try again.</s-paragraph>
        </s-banner>
      )}
      <s-section heading="Checks">
        <s-stack gap="base">
          {items.map((i, n) => (
            <s-banner key={`${i.code}-${n}`} tone={TONE[i.level]} heading={i.code}>
              <s-paragraph>{i.message}</s-paragraph>
            </s-banner>
          ))}
        </s-stack>
      </s-section>
      <s-section heading="Actions">
        <Form method="post">
          <input type="hidden" name="intent" value="resync" />
          <button type="submit" disabled={busy}>
            Re-sync now
          </button>
        </Form>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: HeadersArgs) => boundary.headers(headersArgs);
