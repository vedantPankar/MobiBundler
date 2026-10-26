import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { bundleRepo } from "../bundles/index.server";
import { handleShopErase } from "../bundles/webhookHandlers.server";

// Mandatory privacy webhooks for App Store apps. authenticate.webhook verifies the HMAC (invalid => 401).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // MobiBundler stores no customer data (events carry no PII), so there is nothing to export or erase.
      break;
    case "SHOP_REDACT":
      await handleShopErase({ shop, repo: bundleRepo });
      await db.session.deleteMany({ where: { shop } });
      break;
    default:
      break;
  }
  return new Response();
};
