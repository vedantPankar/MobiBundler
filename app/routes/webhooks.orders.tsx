import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { captureEnabled, writeCapture } from "../bundles/capture.server";
import { ingestOrderForShop } from "../bundles/index.server";

// orders/paid, orders/cancelled and refunds/create. NOT SUBSCRIBED yet: the subscription in shopify.app.toml stays
// commented out until the app is approved for protected customer data. authenticate.webhook verifies the HMAC
// (an invalid signature is rejected with 401 before anything below runs).
//
// Only the order id is taken from the webhook; the order is then re-read from Shopify and ingested through the same
// idempotent path as the sync, so the payload's own shape does not matter. UNVERIFIED: that `id` (orders) and
// `order_id` (refunds) are the field names Shopify sends.
const TOPICS = new Set(["ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE"]);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  if (!TOPICS.has(topic)) return new Response();

  const p = payload as { id?: number | string; order_id?: number | string };
  const orderId = String(topic === "REFUNDS_CREATE" ? p.order_id : p.id);
  if (!/^\d{1,20}$/.test(orderId)) return new Response(); // nothing we can look up; do not make Shopify retry

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch {
    return new Response(); // no offline session (uninstalled): nothing to do, and retrying cannot help
  }

  try {
    if (captureEnabled()) await writeCapture(`${topic.toLowerCase()}-webhook`, orderId, payload);
    const result = await ingestOrderForShop(shop, admin, `gid://shopify/Order/${orderId}`);
    console.log(JSON.stringify({ evt: "order_webhook", shop, topic, result }));
  } catch (e) {
    console.error(JSON.stringify({ evt: "order_webhook_failed", shop, topic, err: (e as Error).message }));
    return new Response("retry", { status: 500 }); // Shopify redelivers; ingestion is idempotent
  }
  return new Response();
};
