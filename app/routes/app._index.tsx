import type { ActionFunctionArgs, HeadersArgs, LoaderFunctionArgs } from "react-router";
import { Suspense } from "react";
import { Await, Form, Link, useLoaderData, useNavigate, useNavigation, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { bundleRepo, revenueRepo, syncRevenueForShop } from "../bundles/index.server";
import { discountLabel, formatMinor } from "../bundles/format";
import { RevenueSection } from "../bundles/RevenueSection";
import { Card, KpiGrid, StatTiles, Welcome } from "../bundles/KpiTile";
import { RevenueLine } from "../bundles/AnalyticsSection";
import { buildAnalytics } from "../bundles/analytics";
import { RecentOrders } from "../bundles/OrdersSection";
import { SuggestionsSection } from "../bundles/SuggestionsSection";
import { buildOrderRows } from "../bundles/orderRows";
import { getSuggestions } from "../bundles/suggestionsLoader.server";
import { revenueViewState, shouldSyncRevenue, splitByCurrency, summarizeRevenue } from "../bundles/revenueSummary";
import { themeEditorDeepLink } from "../bundles/themeLinks";

const RANGES = [7, 30, 60] as const;

// "Sync now": same idempotent sync the dashboard runs on load when the data is stale.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await syncRevenueForShop(session.shop, admin);
  return null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const requested = Number(new URL(request.url).searchParams.get("days"));
  const days = RANGES.find((d) => d === requested) ?? 30;

  // Refresh revenue when the data is older than 5 minutes. Failures are recorded and shown, never thrown.
  const before = await revenueRepo.getState(session.shop);
  if (shouldSyncRevenue(before)) {
    await syncRevenueForShop(session.shop, admin).catch((e) =>
      console.error(JSON.stringify({ evt: "revenue_sync_crashed", shop: session.shop, err: (e as Error).message })),
    );
  }
  const since = new Date(Date.now() - days * 86_400_000);
  const [allRows, unmapped, syncState] = await Promise.all([
    revenueRepo.rows(session.shop, since),
    revenueRepo.unmappedRefunds(session.shop, since),
    revenueRepo.getState(session.shop),
  ]);

  const [counts, recent, events] = await Promise.all([
    bundleRepo.countsByStatus(session.shop),
    bundleRepo.list(session.shop, { sort: "updatedAt", dir: "desc" }),
    bundleRepo.eventCounts(session.shop, 30),
  ]);
  const total = counts.draft + counts.active + counts.paused + counts.archived;
  const allBundles = await bundleRepo.list(session.shop);
  // Money is never added across currencies: show the shop's currency and say how much was left out.
  const shopCurrency = allBundles[0]?.currencyCode ?? allRows[0]?.currencyCode ?? "USD";
  const { rows: revenueRows, otherCurrencyOrders } = splitByCurrency(allRows, shopCurrency);
  const names = new Map(allBundles.map((b) => [b.id, b.name]));
  const recent60 = await revenueRepo.orderPage(session.shop, new Date(Date.now() - 60 * 86_400_000), { filter: "all", page: 1, pageSize: 5 });
  // Streamed: the dashboard renders at once and this section fills in when Shopify has answered (it never rejects).
  const suggestions = getSuggestions(session.shop, admin);
  const { total: rev, byBundle } = summarizeRevenue(revenueRows);
  const currency = shopCurrency;
  const daily = buildAnalytics({ rows: revenueRows, events: {}, since, now: new Date(), names }).daily;
  return {
    daily,
    days,
    currency,
    otherCurrencyOrders,
    revenue: rev,
    recentOrders: { rows: buildOrderRows(recent60.records, recent60.revenue, names), total: recent60.total },
    suggestions,
    revenueByBundle: byBundle.map((b) => ({ ...b, name: names.get(b.bundleId) ?? "Deleted bundle" })),
    unmappedRefunds: unmapped,
    sync: {
      lastSyncedAt: syncState?.lastSyncedAt?.toISOString() ?? null,
      error: syncState?.lastError ?? null,
      errorCode: syncState?.lastErrorCode ?? null,
    },
    themeEditorUrl: themeEditorDeepLink(session.shop, process.env.SHOPIFY_API_KEY ?? ""),
    counts,
    total,
    events,
    syncErrors: recent.filter((b) => b.syncStatus === "error").length,
    recent: recent.slice(0, 5).map((b) => ({
      id: b.id,
      updatedAt: b.updatedAt.toISOString(),
      name: b.name,
      status: b.status,
      pricingKind: b.pricingKind,
      pricingValue: b.pricingValue,
      currencyCode: b.currencyCode,
    })),
  };
};

export default function Dashboard() {
  const { daily, counts, total, events, recent, syncErrors, themeEditorUrl, days, currency, otherCurrencyOrders, revenue, revenueByBundle, unmappedRefunds, sync, recentOrders, suggestions } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const syncing = useNavigation().state !== "idle";
  const view = revenueViewState(sync, revenue);
  return (
    <s-page heading="MobiBundler">
      <s-button slot="secondary-actions" href={themeEditorUrl} target="_blank">
        Add to theme
      </s-button>
      <s-button slot="primary-action" onClick={() => navigate("/app/bundles/new")}>
        Create bundle
      </s-button>

      {syncErrors > 0 && (
        <s-banner tone="critical" heading="Some bundles are not synced to Shopify">
          <s-paragraph>
            {syncErrors} bundle(s) failed to sync, so discounts may not apply at checkout.{" "}
            <Link to="/app/diagnostics">Open diagnostics</Link>
          </s-paragraph>
        </s-banner>
      )}

      {total === 0 ? (
        <s-section heading="Create your first bundle">
          <s-stack gap="base">
            <s-paragraph>
              Pick two or more products, set a percentage or fixed-amount discount, then add the bundle block to a
              product page in the theme editor.
            </s-paragraph>
            <s-button onClick={() => navigate("/app/bundles/new")}>Create bundle</s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-stack gap="base">
          <Welcome title="Welcome back! 👋" subtitle="Here’s an overview of your bundle performance and recent activity.">
            <s-select label="Period" labelAccessibilityVisibility="exclusive" value={String(days)} onChange={(e: Event) => setParams({ days: String((e.currentTarget as HTMLSelectElement).value) })}>
              {[7, 30, 60].map((d) => (
                <s-option key={d} value={String(d)}>
                  Last {d} days
                </s-option>
              ))}
            </s-select>
          </Welcome>

          {(view === "data" || view === "empty") && (
            <KpiGrid
              items={[
                { label: "Net bundle revenue", value: formatMinor(revenue.netRevenueMinor, currency), icon: "dollar", spark: daily.map((d) => d.netMinor) },
                { label: "Bundle orders", value: String(revenue.orders), icon: "box", tone: "blue", spark: daily.map((d) => d.orders) },
                { label: "Average bundle order", value: formatMinor(revenue.averageOrderMinor, currency), icon: "bag" },
                { label: "Discounts given", value: formatMinor(revenue.discountsMinor, currency), icon: "percent", tone: "violet" },
              ]}
            />
          )}

          {(view === "data" || view === "empty") && daily.some((d) => d.netMinor > 0) && (
            <Card title="Bundle revenue" icon="chart">
              <RevenueLine daily={daily} currency={currency} />
            </Card>
          )}

          <Card title="Bundles" icon="box">
            <StatTiles
              items={[
                { label: "Total", value: total, dot: "#9a9a94", icon: "box", tone: "grey" },
                { label: "Active", value: counts.active, dot: "#029886", icon: "play" },
                { label: "Draft", value: counts.draft, dot: "#9a9a94", icon: "doc", tone: "grey" },
                { label: "Paused", value: counts.paused, dot: "#c98a1a", icon: "pause", tone: "amber" },
              ]}
            />
          </Card>

          <div className="mb-two">
          <Card
            title="Recently updated"
            icon="clock"
            action={
              <Link className="mb-card__action" to="/app/bundles">
                View all
              </Link>
            }
          >
            <ul className="mb-list">
              {recent.map((b) => (
                <li className="mb-row" key={b.id}>
                  <div className="mb-row__main">
                    <Link className="mb-row__name" to={`/app/bundles/${b.id}`}>
                      {b.name}
                    </Link>
                    <div className="mb-row__sub">{discountLabel(b)}</div>
                  </div>
                  <span className={b.status === "active" ? "mb-pill" : "mb-pill mb-pill--grey"}>{b.status}</span>
                  <span className="mb-row__sub">{new Date(b.updatedAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </Card>
          <RecentOrders rows={recentOrders.rows} total={recentOrders.total} currency={currency} sync={sync} />
          </div>
        </s-stack>
      )}

      <RevenueSection
        days={days}
        currency={currency}
        revenue={revenue}
        byBundle={revenueByBundle}
        unmapped={unmappedRefunds}
        otherCurrencyOrders={otherCurrencyOrders}
        sync={sync}
        hideTiles
        onPeriodChange={(d) => setParams({ days: String(d) })}
        syncControl={
          <Form method="post">
            <button type="submit" disabled={syncing}>
              {syncing ? "Syncing…" : "Sync orders now"}
            </button>
          </Form>
        }
      />

      <Suspense
        fallback={
          <s-section heading="Suggested bundles">
            <s-paragraph>Looking for products your customers buy together…</s-paragraph>
          </s-section>
        }
      >
        <Await resolve={suggestions}>
          {(o) => <SuggestionsSection currency={currency} result={o.result} error={o.error} onCreate={(url) => navigate(url)} compact={{ limit: 3, viewAllHref: "/app/suggestions" }} />}
        </Await>
      </Suspense>

      <s-section heading="Storefront activity">
        {events.view + events.add_to_cart === 0 ? (
          <s-paragraph>
            No data yet. Bundle views and add-to-cart events (last 30 days) appear here once your storefront block is
            live.
          </s-paragraph>
        ) : (
          <s-stack gap="small">
            <s-text>Views (30 days): {events.view}</s-text>
            <s-text>Add to cart (30 days): {events.add_to_cart}</s-text>
          </s-stack>
        )}
        <s-link href="/app/analytics">View analytics</s-link>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: HeadersArgs) => boundary.headers(headersArgs);
