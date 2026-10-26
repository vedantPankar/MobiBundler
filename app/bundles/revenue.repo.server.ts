import type { PrismaClient } from "@prisma/client";
import type { OrderFilter } from "./orderRows";
import type { RevenueRow } from "./revenueSummary";

export interface OrderRecordInput {
  shop: string;
  orderId: string;
  orderName: string | null;
  orderedAt: Date;
  cancelledAt: Date | null;
  currencyCode: string;
  source: "live" | "backfill";
  fingerprint: string;
  linesHash: string;
  linesJson: string;
  refundsJson: string;
  attributionJson: string;
  reconciled: boolean;
  reconcileNote: string | null;
  unmappedRefundMinor: number;
}
export interface RevenueRowInput {
  bundleId: string;
  sets: number;
  unitsSold: number;
  unitsRefunded: number;
  soldGrossMinor: number;
  soldDiscountMinor: number;
  netMinor: number;
}

/** The only module that touches the revenue tables. */
export function createRevenueRepo(prisma: PrismaClient) {
  return {
    getOrder(shop: string, orderId: string) {
      return prisma.orderRecord.findUnique({ where: { shop_orderId: { shop, orderId } } });
    },

    /** Replaces everything derived from one order atomically, so a retry can never leave partial or doubled rows. */
    async saveOrder(rec: OrderRecordInput, rows: RevenueRowInput[]) {
      const { shop, orderId } = rec;
      await prisma.$transaction(async (tx) => {
        await tx.orderRecord.upsert({
          where: { shop_orderId: { shop, orderId } },
          create: rec,
          update: { ...rec, shop: undefined, orderId: undefined },
        });
        await tx.bundleOrderRevenue.deleteMany({ where: { shop, orderId } });
        if (rows.length > 0) {
          await tx.bundleOrderRevenue.createMany({
            data: rows.map((r) => ({
              ...r,
              shop,
              orderId,
              orderedAt: rec.orderedAt,
              source: rec.source,
              currencyCode: rec.currencyCode,
              cancelled: rec.cancelledAt !== null,
              reconciled: rec.reconciled,
            })),
          });
        }
      });
    },

    async rows(shop: string, since: Date): Promise<(RevenueRow & { currencyCode: string; orderedAt: Date })[]> {
      return prisma.bundleOrderRevenue.findMany({ where: { shop, orderedAt: { gte: since } } });
    },

    /** One page of stored bundle orders (newest first) with their per-bundle revenue rows. */
    async orderPage(shop: string, since: Date, o: { filter: OrderFilter; page: number; pageSize: number }) {
      const base = { shop, orderedAt: { gte: since } };
      let where: Record<string, unknown> = base;
      if (o.filter === "live") where = { ...base, source: "live" };
      else if (o.filter === "historical") where = { ...base, source: "backfill" };
      else if (o.filter === "estimates") where = { ...base, reconciled: false };
      else if (o.filter === "cancelled") where = { ...base, cancelledAt: { not: null } };
      else if (o.filter === "refunded") {
        const hit = await prisma.bundleOrderRevenue.findMany({
          where: { shop, orderedAt: { gte: since }, unitsRefunded: { gt: 0 }, cancelled: false },
          select: { orderId: true },
          distinct: ["orderId"],
        });
        where = { ...base, orderId: { in: hit.map((h) => h.orderId) } };
      }
      const [total, records] = await Promise.all([
        prisma.orderRecord.count({ where }),
        prisma.orderRecord.findMany({
          where,
          orderBy: [{ orderedAt: "desc" }, { orderId: "desc" }],
          skip: Math.max(0, o.page - 1) * o.pageSize,
          take: o.pageSize,
        }),
      ]);
      const revenue = records.length
        ? await prisma.bundleOrderRevenue.findMany({ where: { shop, orderId: { in: records.map((r) => r.orderId) } } })
        : [];
      return { total, records, revenue };
    },

    async unmappedRefunds(shop: string, since: Date) {
      const a = await prisma.orderRecord.aggregate({
        where: { shop, orderedAt: { gte: since }, unmappedRefundMinor: { gt: 0 } },
        _sum: { unmappedRefundMinor: true },
        _count: { _all: true },
      });
      return { minor: a._sum.unmappedRefundMinor ?? 0, orders: a._count._all };
    },

    /**
     * Orders worth re-reading: last seen as estimates (the config or code may have been corrected) or stored before the
     * order number was captured. Oldest first.
     */
    async unreconciledOrderIds(shop: string, limit: number) {
      const rows = await prisma.orderRecord.findMany({
        where: { shop, OR: [{ reconciled: false }, { orderName: null }] },
        orderBy: { syncedAt: "asc" },
        take: limit,
        select: { orderId: true },
      });
      return rows.map((r) => r.orderId);
    },

    getState(shop: string) {
      return prisma.revenueSyncState.findUnique({ where: { shop } });
    },
    /** First sync stamps when tracking began: orders placed before it are historical (backfill). */
    async ensureState(shop: string, now: Date) {
      return prisma.revenueSyncState.upsert({
        where: { shop },
        create: { shop, trackingStartedAt: now },
        update: {},
      });
    },
    async recordSuccess(shop: string, now: Date, lastOrderUpdatedAt: Date | null) {
      await prisma.revenueSyncState.update({
        where: { shop },
        data: { lastSyncedAt: now, lastError: null, lastErrorAt: null, lastErrorCode: null, ...(lastOrderUpdatedAt ? { lastOrderUpdatedAt } : {}) },
      });
    },
    async recordError(shop: string, now: Date, message: string, code: string) {
      await prisma.revenueSyncState.update({
        where: { shop },
        data: { lastError: message, lastErrorAt: now, lastErrorCode: code },
      });
    },

    async deleteAllForShop(shop: string) {
      await prisma.bundleOrderRevenue.deleteMany({ where: { shop } });
      await prisma.orderRecord.deleteMany({ where: { shop } });
      await prisma.revenueSyncState.deleteMany({ where: { shop } });
    },
  };
}
export type RevenueRepo = ReturnType<typeof createRevenueRepo>;
