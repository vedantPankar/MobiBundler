import type { HeadersArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { bundleRepo, revenueRepo } from "../bundles/index.server";
import { buildAnalytics } from "../bundles/analytics";
import { AnalyticsSection } from "../bundles/AnalyticsSection";
import { revenueViewState, splitByCurrency } from "../bundles/revenueSummary";

const RANGES = [7, 30, 60] as const;

// Read-only: the dashboard owns order syncing. Storefront counts need no order access and are always shown.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const days = RANGES.find((d) => d === Number(new URL(request.url).searchParams.get("days"))) ?? 30;
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);

  const [rows, events, bundles, state] = await Promise.all([
    revenueRepo.rows(session.shop, since),
    bundleRepo.eventCountsByBundle(session.shop, since),
    bundleRepo.list(session.shop),
    revenueRepo.getState(session.shop),
  ]);
  const currency = bundles[0]?.currencyCode ?? "USD";
  const sameCurrency = splitByCurrency(rows, currency).rows;
  const result = buildAnalytics({ rows: sameCurrency, events, since, now, names: new Map(bundles.map((b) => [b.id, b.name])) });
  const sync = { lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null, error: state?.lastError ?? null, errorCode: state?.lastErrorCode ?? null };
  const revenueState = revenueViewState(sync, { orders: result.kpis.orders, cancelledOrders: sameCurrency.filter((r) => r.cancelled).length });
  return { days, currency, result, revenueState, sync: { error: sync.error, errorCode: sync.errorCode } };
};

export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  const [, setParams] = useSearchParams();
  return (
    <s-page heading="Analytics">
      <AnalyticsSection {...data} onPeriodChange={(d) => setParams({ days: String(d) })} />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: HeadersArgs) => boundary.headers(headersArgs);
