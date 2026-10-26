import type { Prisma, PrismaClient } from "@prisma/client";
import type { BundleInput, BundleStatus, StoredBundle } from "./types";

const include = { items: { orderBy: { position: "asc" as const } } };
type Row = Prisma.BundleGetPayload<{ include: typeof include }>;

const map = (r: Row): StoredBundle => ({
  ...r,
  status: r.status as BundleStatus,
  pricingKind: r.pricingKind as StoredBundle["pricingKind"],
  items: r.items.map((i) => ({
    id: i.id,
    productId: i.productId,
    variantId: i.variantId,
    quantity: i.quantity,
    position: i.position,
  })),
});

export function createBundleRepo(prisma: PrismaClient) {
  const itemsData = (shop: string, input: BundleInput) =>
    input.items.map((i, position) => ({
      shop,
      position,
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
    }));

  return {
    async list(
      shop: string,
      opts: { status?: BundleStatus; search?: string; sort?: "updatedAt" | "name"; dir?: "asc" | "desc" } = {},
    ) {
      const rows = await prisma.bundle.findMany({
        where: {
          shop,
          ...(opts.status ? { status: opts.status } : {}),
          ...(opts.search ? { name: { contains: opts.search } } : {}),
        },
        orderBy: { [opts.sort ?? "updatedAt"]: opts.dir ?? "desc" },
        include,
      });
      return rows.map(map);
    },

    async get(shop: string, id: string) {
      const r = await prisma.bundle.findFirst({ where: { id, shop }, include });
      return r ? map(r) : null;
    },

    async create(shop: string, currencyCode: string, input: BundleInput) {
      const r = await prisma.bundle.create({
        data: {
          shop,
          currencyCode,
          name: input.name,
          description: input.description ?? null,
          status: input.status,
          pricingKind: input.pricingKind,
          pricingValue: input.pricingValue,
          buttonLabel: input.buttonLabel || null,
          showSavings: input.showSavings ?? true,
          items: { create: itemsData(shop, input) },
        },
        include,
      });
      return map(r);
    },

    async update(shop: string, id: string, expectedVersion: number, input: BundleInput) {
      return prisma.$transaction(async (tx) => {
        const res = await tx.bundle.updateMany({
          where: { id, shop, version: expectedVersion },
          data: {
            name: input.name,
            description: input.description ?? null,
            status: input.status,
            pricingKind: input.pricingKind,
            pricingValue: input.pricingValue,
            buttonLabel: input.buttonLabel || null,
            showSavings: input.showSavings ?? true,
            version: { increment: 1 },
            syncStatus: "pending",
            syncError: null,
          },
        });
        if (res.count === 0) {
          return (await tx.bundle.findFirst({ where: { id, shop } })) ? ("conflict" as const) : null;
        }
        await tx.bundleItem.deleteMany({ where: { bundleId: id, shop } });
        await tx.bundleItem.createMany({
          data: itemsData(shop, input).map((d) => ({ ...d, bundleId: id })),
        });
        return map(await tx.bundle.findFirstOrThrow({ where: { id, shop }, include }));
      });
    },

    async setStatus(shop: string, id: string, status: BundleStatus) {
      const res = await prisma.bundle.updateMany({
        where: { id, shop },
        data: { status, version: { increment: 1 }, syncStatus: "pending", syncError: null },
      });
      return res.count ? map(await prisma.bundle.findFirstOrThrow({ where: { id, shop }, include })) : null;
    },

    async duplicate(shop: string, id: string) {
      const src = await prisma.bundle.findFirst({ where: { id, shop }, include });
      if (!src) return null;
      const names = new Set(
        (await prisma.bundle.findMany({ where: { shop }, select: { name: true } })).map((n) => n.name),
      );
      let name = `${src.name} (copy)`;
      for (let n = 2; names.has(name); n++) name = `${src.name} (copy ${n})`;
      const r = await prisma.bundle.create({
        data: {
          shop,
          name,
          description: src.description,
          type: src.type,
          status: "draft",
          pricingKind: src.pricingKind,
          pricingValue: src.pricingValue,
          currencyCode: src.currencyCode,
          buttonLabel: src.buttonLabel,
          showSavings: src.showSavings,
          items: {
            create: src.items.map((i) => ({
              shop,
              position: i.position,
              productId: i.productId,
              variantId: i.variantId,
              quantity: i.quantity,
            })),
          },
        },
        include,
      });
      return map(r);
    },

    async activeForShop(shop: string) {
      return (await prisma.bundle.findMany({ where: { shop, status: "active" }, include })).map(map);
    },

    async markSync(shop: string, ids: string[], status: "synced" | "error", error?: string) {
      await prisma.bundle.updateMany({
        where: { shop, id: { in: ids } },
        data: { syncStatus: status, syncError: error ?? null },
      });
    },

    async deleteAllForShop(shop: string) {
      await prisma.$transaction([
        prisma.bundleItem.deleteMany({ where: { shop } }),
        prisma.bundleEvent.deleteMany({ where: { shop } }),
        prisma.bundle.deleteMany({ where: { shop } }),
        prisma.shopDiscount.deleteMany({ where: { shop } }),
        prisma.bundleOrderRevenue.deleteMany({ where: { shop } }),
        prisma.orderRecord.deleteMany({ where: { shop } }),
        prisma.revenueSyncState.deleteMany({ where: { shop } }),
      ]);
    },

    async countsByStatus(shop: string) {
      const g = await prisma.bundle.groupBy({ by: ["status"], where: { shop }, _count: { _all: true } });
      const out: Record<BundleStatus, number> = { draft: 0, active: 0, paused: 0, archived: 0 };
      for (const r of g) out[r.status as BundleStatus] = r._count._all;
      return out;
    },

    /** A deleted product breaks its active bundles: pause (never delete) and say why. Idempotent. */
    async pauseForDeletedProduct(shop: string, productId: string) {
      const items = await prisma.bundleItem.findMany({
        where: { shop, productId, bundle: { status: "active" } },
        select: { bundleId: true },
      });
      const ids = [...new Set(items.map((i) => i.bundleId))];
      if (ids.length === 0) return 0;
      await prisma.bundle.updateMany({
        where: { shop, id: { in: ids }, status: "active" },
        data: {
          status: "paused",
          version: { increment: 1 },
          syncStatus: "pending",
          syncError: "A product in this bundle was deleted from your store. Replace it, then reactivate.",
        },
      });
      return ids.length;
    },

    async eventCounts(shop: string, sinceDays?: number) {
      const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000) : undefined;
      const g = await prisma.bundleEvent.groupBy({
        by: ["type"],
        where: { shop, ...(since ? { createdAt: { gte: since } } : {}) },
        _count: { _all: true },
      });
      const out = { view: 0, add_to_cart: 0 };
      for (const r of g) if (r.type === "view" || r.type === "add_to_cart") out[r.type] = r._count._all;
      return out;
    },

    /** Views and add-to-cart events per bundle since `since` (anonymous counts only). */
    async eventCountsByBundle(shop: string, since: Date) {
      const g = await prisma.bundleEvent.groupBy({
        by: ["bundleId", "type"],
        where: { shop, createdAt: { gte: since } },
        _count: { _all: true },
      });
      const out: Record<string, { view: number; add_to_cart: number }> = {};
      for (const r of g) {
        if (r.type !== "view" && r.type !== "add_to_cart") continue;
        (out[r.bundleId] ??= { view: 0, add_to_cart: 0 })[r.type] = r._count._all;
      }
      return out;
    },

    /** Ownership-checked and idempotent per (shop, dedupeKey). `skipDuplicates` is unsupported on SQLite. */
    async recordEvent(
      shop: string,
      bundleId: string,
      type: "view" | "add_to_cart",
      dedupeKey: string,
    ): Promise<"recorded" | "duplicate" | "ignored"> {
      const owned = await prisma.bundle.findFirst({ where: { id: bundleId, shop }, select: { id: true } });
      if (!owned) return "ignored";
      try {
        await prisma.bundleEvent.create({ data: { shop, bundleId, type, dedupeKey } });
        return "recorded";
      } catch (e) {
        if ((e as { code?: string })?.code === "P2002") return "duplicate";
        throw e;
      }
    },

    /** Newest-first ids of ACTIVE bundles that contain this product. `productId` is the numeric Shopify id. */
    async activeIdsForProduct(shop: string, productId: string, limit = 3) {
      const rows = await prisma.bundle.findMany({
        where: { shop, status: "active", items: { some: { productId: `gid://shopify/Product/${productId}` } } },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    async variantsInUse(shop: string, variantIds: string[], excludeBundleId?: string) {
      const rows = await prisma.bundleItem.findMany({
        where: {
          shop,
          variantId: { in: variantIds },
          bundle: { status: "active", ...(excludeBundleId ? { id: { not: excludeBundleId } } : {}) },
        },
        select: { variantId: true },
      });
      return [...new Set(rows.map((r) => r.variantId))];
    },
  };
}

export type BundleRepo = ReturnType<typeof createBundleRepo>;
