import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { bundleRepo, syncForShop } from "../bundles/index.server";
import { handleProductDeleted } from "../bundles/webhookHandlers.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Verifies the HMAC signature; an invalid signature is rejected with 401 before any handler runs.
  const { shop, payload } = await authenticate.webhook(request);

  const { affected } = await handleProductDeleted({
    shop,
    productId: `gid://shopify/Product/${(payload as { id: number | string }).id}`,
    repo: bundleRepo,
  });

  if (affected > 0) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      await syncForShop(shop, admin);
    } catch {
      // No offline session (e.g. already uninstalled): bundles stay paused/pending; nothing else to do.
    }
  }
  return new Response();
};
