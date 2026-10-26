import type { HeadersArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { bundleRepo, revenueRepo } from "../bundles/index.server";
import { OrdersSection } from "../bundles/OrdersSection";
import { buildOrderRows, parseOrderFilter } from "../bundles/orderRows";

const PAGE_SIZE = 25;
const RANGES = [7, 30, 60] as const;

// Read-only: the dashboard owns syncing. This page lists what has been synced.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = RANGES.find((d) => d === Number(url.searchParams.get("days"))) ?? 30;
  const filter = parseOrderFilter(url.searchParams.get("show"));
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page"))) || 1);
  const since = new Date(Date.now() - days * 86_400_000);

  const [{ total, records, revenue }, bundles, state] = await Promise.all([
    revenueRepo.orderPage(session.shop, since, { filter, page, pageSize: PAGE_SIZE }),
    bundleRepo.list(session.shop),
    revenueRepo.getState(session.shop),
  ]);
  const rows = buildOrderRows(records, revenue, new Map(bundles.map((b) => [b.id, b.name])));
  return {
    rows: rows.map((r) => ({ ...r })),
    total,
    page,
    pageSize: PAGE_SIZE,
    days,
    filter,
    currency: bundles[0]?.currencyCode ?? "USD",
    sync: { lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null, error: state?.lastError ?? null },
  };
};

export default function Orders() {
  const data = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  return (
    <s-page heading="Bundle orders">
      <OrdersSection
        {...data}
        onChange={(next) => {
          const p = new URLSearchParams(params);
          if (next.days) p.set("days", String(next.days));
          if (next.filter) p.set("show", next.filter);
          if (next.page) p.set("page", String(next.page));
          setParams(p);
        }}
      />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: HeadersArgs) => boundary.headers(headersArgs);
