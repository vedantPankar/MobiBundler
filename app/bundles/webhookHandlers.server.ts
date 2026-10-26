import type { BundleRepo } from "./repo.server";

/** shop/redact and app/uninstalled: remove all of the shop's bundle data. Replay-safe (deleteMany). */
export async function handleShopErase(d: { shop: string; repo: BundleRepo }) {
  await d.repo.deleteAllForShop(d.shop);
}

export async function handleProductDeleted(d: { shop: string; productId: string; repo: BundleRepo }) {
  return { affected: await d.repo.pauseForDeletedProduct(d.shop, d.productId) };
}
