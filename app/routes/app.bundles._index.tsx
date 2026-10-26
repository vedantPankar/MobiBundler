import type { ActionFunctionArgs, HeadersArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigate, useNavigation, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { bundleRepo, revenueRepo, syncForShop } from "../bundles/index.server";
import { runBundleAction } from "../bundles/actions.server";
import { discountLabel, formatMinor } from "../bundles/format";
import { Card, Icon, StatTiles } from "../bundles/KpiTile";
import { revenueViewState, splitByCurrency, summarizeRevenue } from "../bundles/revenueSummary";
import type { BundleStatus } from "../bundles/types";
import { themeEditorDeepLink } from "../bundles/themeLinks";

const STATUSES = ["draft", "active", "paused", "archived"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = STATUSES.find((s) => s === url.searchParams.get("status"));
  const sort = url.searchParams.get("sort") === "name" ? "name" : "updatedAt";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const bundles = await bundleRepo.list(session.shop, {
    status: status as BundleStatus | undefined,
    search: url.searchParams.get("q") ?? undefined,
    sort,
    dir,
  });
  // All-time per-bundle revenue (the 60-day backfill window plus anything tracked since). "—" unless orders have synced.
  const [counts, rows, state] = await Promise.all([
    bundleRepo.countsByStatus(session.shop),
    revenueRepo.rows(session.shop, new Date(0)),
    revenueRepo.getState(session.shop),
  ]);
  const currency = bundles[0]?.currencyCode ?? "USD";
  const { byBundle } = summarizeRevenue(splitByCurrency(rows, currency).rows);
  const revenue = Object.fromEntries(byBundle.map((b) => [b.bundleId, { netMinor: b.netRevenueMinor, orders: b.orders }]));
  const sync = { lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null, error: state?.lastError ?? null, errorCode: state?.lastErrorCode ?? null };
  const revenueKnown = ["data", "empty"].includes(revenueViewState(sync, { orders: byBundle.length, cancelledOrders: 0 }));
  return {
    counts,
    revenue,
    revenueKnown,
    currency,
    themeEditorUrl: themeEditorDeepLink(session.shop, process.env.SHOPIFY_API_KEY ?? ""),
    bundles: bundles.map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      pricingKind: b.pricingKind,
      pricingValue: b.pricingValue,
      currencyCode: b.currencyCode,
      items: b.items.length,
      syncStatus: b.syncStatus,
      syncError: b.syncError,
      updatedAt: b.updatedAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  return runBundleAction(
    { shop: session.shop, repo: bundleRepo, sync: () => syncForShop(session.shop, admin) },
    await request.formData(),
  );
};

export default function Bundles() {
  const { bundles, themeEditorUrl, counts, revenue, revenueKnown, currency } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const busy = navigation.state !== "idle";
  const filtered = Boolean(params.get("q") || params.get("status"));

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <s-page heading="Bundles">
      <s-button slot="secondary-actions" href={themeEditorUrl} target="_blank">
        Add to theme
      </s-button>
      <s-button slot="primary-action" onClick={() => navigate("/app/bundles/new")}>
        Create bundle
      </s-button>
      {result && (
        <s-banner tone={result.ok ? "success" : "critical"} dismissible>
          {result.message}
        </s-banner>
      )}
      <StatTiles
        items={[
          { label: "Total bundles", value: counts.draft + counts.active + counts.paused + counts.archived, dot: "#9a9a94", icon: "box", tone: "blue" },
          { label: "Active bundles", value: counts.active, dot: "#029886", icon: "play" },
          { label: "Draft bundles", value: counts.draft, dot: "#9a9a94", icon: "doc", tone: "grey" },
          { label: "Paused/Archived", value: counts.paused + counts.archived, dot: "#c98a1a", icon: "pause", tone: "amber" },
        ]}
      />
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-search-field
            label="Search bundles"
            labelAccessibilityVisibility="exclusive"
            placeholder="Search by name"
            value={params.get("q") ?? ""}
            onInput={(e: Event) => update("q", (e.currentTarget as HTMLInputElement).value)}
          />
          <s-select
            label="Status"
            labelAccessibilityVisibility="exclusive"
            value={params.get("status") ?? ""}
            onChange={(e: Event) => update("status", (e.currentTarget as HTMLSelectElement).value)}
          >
            <s-option value="">All statuses</s-option>
            {STATUSES.map((s) => (
              <s-option key={s} value={s}>
                {s}
              </s-option>
            ))}
          </s-select>
          <s-select
            label="Sort"
            labelAccessibilityVisibility="exclusive"
            value={`${params.get("sort") ?? "updatedAt"}:${params.get("dir") ?? "desc"}`}
            onChange={(e: Event) => {
              const [s, d] = (e.currentTarget as HTMLSelectElement).value.split(":");
              const next = new URLSearchParams(params);
              next.set("sort", s);
              next.set("dir", d);
              setParams(next, { replace: true });
            }}
          >
            <s-option value="updatedAt:desc">Recently updated</s-option>
            <s-option value="name:asc">Name A–Z</s-option>
            <s-option value="name:desc">Name Z–A</s-option>
          </s-select>
        </s-stack>
      </s-section>

      {bundles.length === 0 ? (
        <s-section>
          <s-stack gap="base">
            <s-heading>{filtered ? "No bundles match your filters" : "No bundles yet"}</s-heading>
            <s-paragraph>
              {filtered
                ? "Try a different search or status."
                : "Create a fixed bundle: pick products, set a discount, and show it on your product pages."}
            </s-paragraph>
            {!filtered && <s-button onClick={() => navigate("/app/bundles/new")}>Create bundle</s-button>}
          </s-stack>
        </s-section>
      ) : (
        <Form method="post">
          <div className="mb-card mb-tablecard">
            <table className="mb-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Bundle</th>
                  <th>Products</th>
                  <th>Discount</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Revenue</th>
                  <th>Orders</th>
                </tr>
              </thead>
              <tbody>
                {bundles.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <input type="checkbox" name="ids" value={b.id} aria-label={`Select ${b.name}`} />
                    </td>
                    <td>
                      <span className="mb-namecell">
                        <Icon name="box" tone="grey" />
                        <span>
                          <Link className="mb-row__name" to={`/app/bundles/${b.id}`}>
                            {b.name}
                          </Link>
                          {b.syncStatus === "error" && <s-badge tone="critical">Sync failed</s-badge>}
                        </span>
                      </span>
                    </td>
                    <td>{b.items} products</td>
                    <td>{discountLabel(b)}</td>
                    <td>
                      <span className={b.status === "active" ? "mb-pill" : "mb-pill mb-pill--grey"}>{b.status}</span>
                    </td>
                    <td>{new Date(b.updatedAt).toLocaleDateString()}</td>
                    <td>{revenueKnown ? formatMinor(revenue[b.id]?.netMinor ?? 0, currency) : "—"}</td>
                    <td>{revenueKnown ? (revenue[b.id]?.orders ?? 0) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mb-row__sub">{bundles.length} bundle(s)</div>
          </div>
          <s-stack direction="inline" gap="base">
            {["activate", "pause", "archive", "duplicate"].map((i) => (
              <button key={i} type="submit" name="intent" value={i} disabled={busy}>
                {i[0].toUpperCase() + i.slice(1)} selected
              </button>
            ))}
          </s-stack>
        </Form>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: HeadersArgs) => boundary.headers(headersArgs);
