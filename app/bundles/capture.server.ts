import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// DEV-ONLY payload capture for validating revenue attribution against real Shopify data. It is removed (or
// stays disabled) once the attribution logic has been validated. Never active in production.
const PII_KEY =
  /^(customer|billing_address|shipping_address|email|contact_email|phone|browser_ip|client_details|note|note_attributes|payment_details|payment_gateway_names|landing_site|referring_site|source_url|user_id|device_id|location_id|app_id|token|cart_token|checkout_token|confirmation_number|order_status_url)$/i;

/** Recursively drops customer-identifying keys so capture files carry commercial data only. */
export function sanitizePayload(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sanitizePayload);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (PII_KEY.test(k)) continue;
      out[k] = sanitizePayload(val);
    }
    return out;
  }
  return v;
}

// Fails closed: only an explicit development run (shopify app dev sets NODE_ENV=development) can capture.
export const captureEnabled = () => process.env.NODE_ENV === "development" && process.env.MOBI_CAPTURE !== "off";

export async function writeCapture(kind: string, id: string | number, data: unknown): Promise<string | null> {
  if (!captureEnabled()) return null;
  const dir = path.resolve(".captures");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${kind}-${String(id).replace(/[^A-Za-z0-9_-]/g, "")}.json`);
  // "wx": fail rather than overwrite an existing capture.
  await writeFile(file, JSON.stringify(sanitizePayload(data), null, 2), { flag: "wx" });
  return file;
}

// Read-only. Same order as GraphQL sees it, so the later 60-day backfill can reuse this shape.
const ORDER_FIELDS = `
    id createdAt cancelledAt displayFinancialStatus currencyCode presentmentCurrencyCode
    discountApplications(first: 20) {
      nodes {
        __typename allocationMethod targetSelection targetType
        value { __typename ... on MoneyV2 { amount currencyCode } ... on PricingPercentageValue { percentage } }
        ... on AutomaticDiscountApplication { title }
      }
    }
    lineItems(first: 50) {
      nodes {
        id title quantity currentQuantity variant { id } product { id }
        customAttributes { key value }
        originalUnitPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        discountedUnitPriceSet { shopMoney { amount } presentmentMoney { amount } }
        discountAllocations {
          allocatedAmountSet { shopMoney { amount } presentmentMoney { amount } }
          discountApplication { __typename ... on AutomaticDiscountApplication { title } }
        }
      }
    }
    refunds {
      id createdAt
      totalRefundedSet { shopMoney { amount } }
      refundLineItems(first: 50) { nodes { quantity lineItem { id } subtotalSet { shopMoney { amount } } } }
    }
`;

export const ORDER_CAPTURE_QUERY = `#graphql
query CaptureOrder($id: ID!) {
  order(id: $id) {${ORDER_FIELDS}}
}`;

/** `name` is the order number as the merchant sees it, e.g. "1001". */
export const ORDER_BY_NAME_QUERY = `#graphql
query CaptureOrderByName($q: String!) {
  orders(first: 1, query: $q) { nodes {${ORDER_FIELDS}} }
}`;

export const ORDER_BY_NUMBER_QUERY = `#graphql
query CaptureOrderByNumber($q: String!) {
  orders(first: 2, query: $q) { nodes { id } }
}`;
