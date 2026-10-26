import prisma from "../db.server";
import { createBundleRepo } from "./repo.server";
import { syncShop } from "./sync.server";
import { adminDiscountGateway } from "./shopifyDiscount.server";
import { createRevenueRepo } from "./revenue.repo.server";
import { adminOrdersFetcher, fetchOrderById } from "./ordersSource.server";
import { ingestOrderById, syncOrders } from "./revenueSync.server";

export const bundleRepo = createBundleRepo(prisma);

export const syncForShop = (shop: string, admin: Parameters<typeof adminDiscountGateway>[0]) =>
  syncShop({ shop, prisma, repo: bundleRepo, gateway: adminDiscountGateway(admin) });

export const revenueRepo = createRevenueRepo(prisma);

export const syncRevenueForShop = (shop: string, admin: Parameters<typeof adminOrdersFetcher>[0]) =>
  syncOrders({
    shop,
    repo: revenueRepo,
    bundleRepo,
    fetchPage: adminOrdersFetcher(admin),
    fetchOrder: (id) => fetchOrderById(admin, id),
  });

export const ingestOrderForShop = (shop: string, admin: Parameters<typeof fetchOrderById>[0], orderGid: string) =>
  ingestOrderById({ shop, orderGid, repo: revenueRepo, bundleRepo, fetchOrder: (id) => fetchOrderById(admin, id) });
