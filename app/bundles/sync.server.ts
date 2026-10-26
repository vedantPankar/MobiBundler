import type { PrismaClient } from "@prisma/client";
import { ConfigTooLargeError, TooManyBundlesError, serializeSharedConfig } from "./config";
import type { BundleRepo } from "./repo.server";

export class ShopifyUserError extends Error {}

/**
 * Boundary to Shopify. UNVERIFIED against a live store: the real implementation
 * (shopifyDiscount.server.ts) has never been executed. Tests use a fake.
 */
export interface DiscountGateway {
  create(configJson: string): Promise<{ discountId: string }>;
  update(discountId: string, configJson: string): Promise<void>;
  setActive(discountId: string, active: boolean): Promise<void>;
  inspect(discountId: string): Promise<{ status: string; configJson: string | null } | null>;
}

export type SyncResult = {
  status: "noop" | "created" | "updated" | "deactivated" | "error";
  message?: string;
};

const INACTIVE = "inactive";
const locks = new Map<string, Promise<unknown>>();

/** Serialises syncs per shop within one process so two requests cannot both create the discount. */
function withShopLock<T>(shop: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(shop) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(shop, next);
  next.finally(() => {
    if (locks.get(shop) === next) locks.delete(shop);
  }).catch(() => {});
  return next;
}

export function syncShop(d: {
  shop: string;
  prisma: PrismaClient;
  repo: BundleRepo;
  gateway: DiscountGateway;
}): Promise<SyncResult> {
  return withShopLock(d.shop, () => doSync(d));
}

async function doSync({
  shop,
  prisma,
  repo,
  gateway,
}: {
  shop: string;
  prisma: PrismaClient;
  repo: BundleRepo;
  gateway: DiscountGateway;
}): Promise<SyncResult> {
  const active = await repo.activeForShop(shop);
  const ids = active.map((b) => b.id);
  const row = await prisma.shopDiscount.findUnique({ where: { shop } });

  try {
    if (active.length === 0) {
      if (!row?.shopifyDiscountId || row.configHash === INACTIVE) return { status: "noop" };
      await gateway.setActive(row.shopifyDiscountId, false);
      await prisma.shopDiscount.update({
        where: { shop },
        data: { configHash: INACTIVE, syncedAt: new Date() },
      });
      return { status: "deactivated" };
    }

    const { json, hash } = serializeSharedConfig(active);
    if (row?.configHash === hash) {
      await repo.markSync(shop, ids, "synced");
      return { status: "noop" };
    }

    if (!row?.shopifyDiscountId) {
      const { discountId } = await gateway.create(json);
      await prisma.shopDiscount.upsert({
        where: { shop },
        create: { shop, shopifyDiscountId: discountId, configHash: hash, syncedAt: new Date() },
        update: { shopifyDiscountId: discountId, configHash: hash, syncedAt: new Date() },
      });
      await repo.markSync(shop, ids, "synced");
      return { status: "created" };
    }

    if (row.configHash === INACTIVE) await gateway.setActive(row.shopifyDiscountId, true);
    await gateway.update(row.shopifyDiscountId, json);
    await prisma.shopDiscount.update({ where: { shop }, data: { configHash: hash, syncedAt: new Date() } });
    await repo.markSync(shop, ids, "synced");
    return { status: "updated" };
  } catch (e) {
    const known =
      e instanceof ShopifyUserError || e instanceof ConfigTooLargeError || e instanceof TooManyBundlesError;
    const message = known ? (e as Error).message : "Unexpected error while syncing; try again.";
    if (!known) console.error(JSON.stringify({ evt: "sync_failed", shop, err: (e as Error).name }));
    await repo.markSync(shop, ids, "error", message);
    return { status: "error", message };
  }
}
