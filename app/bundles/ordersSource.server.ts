import type { RawOrder } from "./orderNormalizer";
import type { FetchOrdersPage } from "./revenueSync.server";

type Admin = { graphql: (q: string, o?: { variables?: Record<string, unknown> }) => Promise<Response> };

// UNVERIFIED: never executed against Shopify (blocked on protected customer data access). It asks for no
// customer, address, email or phone fields. Only the last 60 days are readable without extra Shopify approval.
const ORDER_FIELDS = `
      id name createdAt updatedAt cancelledAt currencyCode
      lineItems(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id quantity currentQuantity variant { id }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          discountAllocations {
            allocatedAmountSet { shopMoney { amount } }
            discountApplication { __typename ... on AutomaticDiscountApplication { title } }
          }
        }
      }
      refunds {
        id
        totalRefundedSet { shopMoney { amount } }
        refundLineItems(first: 100) { pageInfo { hasNextPage } nodes { quantity lineItem { id } } }
      }
`;

export const ORDERS_SYNC_QUERY = `#graphql
query SyncOrders($first: Int!, $after: String, $q: String!) {
  orders(first: $first, after: $after, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {${ORDER_FIELDS}}
  }
}`;

export const ORDER_BY_ID_QUERY = `#graphql
query SyncOrder($id: ID!) {
  order(id: $id) {${ORDER_FIELDS}}
}`;

/** Fresh copy of one order, or null when it no longer exists. Webhooks use this instead of trusting their payload. */
export async function fetchOrderById(admin: Admin, id: string): Promise<RawOrder | null> {
  const res = await admin.graphql(ORDER_BY_ID_QUERY, { variables: { id } });
  const body = (await res.json()) as { data?: { order: RawOrder | null }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data?.order ?? null;
}

export function adminOrdersFetcher(admin: Admin): FetchOrdersPage {
  return async ({ updatedSince, after }) => {
    const res = await admin.graphql(ORDERS_SYNC_QUERY, {
      variables: { first: 50, after, q: `updated_at:>='${updatedSince.toISOString()}'` },
    });
    const body = (await res.json()) as {
      data?: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawOrder[] } };
      errors?: { message: string }[];
    };
    if (body.errors?.length) throw new Error(body.errors[0].message);
    const o = body.data!.orders;
    return { orders: o.nodes, hasNext: o.pageInfo.hasNextPage, endCursor: o.pageInfo.endCursor };
  };
}

// Suggestions need only which variants shared an order. No prices, customer, address or note fields.
export const ORDER_BASKETS_QUERY = `#graphql
query OrderBaskets($first: Int!, $after: String, $q: String!) {
  orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id lineItems(first: 50) { nodes { variant { id } } } }
  }
}`;

export const BASKET_PAGE_SIZE = 50;
export const BASKET_MAX_PAGES = 5;

/** The most recent orders since `since`, newest first, as sets of variant ids. */
export async function fetchBaskets(admin: Admin, since: Date) {
  const baskets: { orderId: string; variantIds: string[] }[] = [];
  let after: string | null = null;
  let truncated = false;
  for (let page = 0; page < BASKET_MAX_PAGES; page++) {
    const res = await admin.graphql(ORDER_BASKETS_QUERY, {
      variables: { first: BASKET_PAGE_SIZE, after, q: `created_at:>='${since.toISOString()}'` },
    });
    const body = (await res.json()) as {
      data?: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; lineItems: { nodes: { variant: { id: string } | null }[] } }[] } };
      errors?: { message: string }[];
    };
    if (body.errors?.length) throw new Error(body.errors[0].message);
    const o = body.data!.orders;
    for (const n of o.nodes) {
      baskets.push({ orderId: n.id, variantIds: n.lineItems.nodes.flatMap((l) => (l.variant ? [l.variant.id] : [])) });
    }
    if (!o.pageInfo.hasNextPage) return { baskets, truncated };
    after = o.pageInfo.endCursor;
    if (page === BASKET_MAX_PAGES - 1) truncated = true;
  }
  return { baskets, truncated };
}
