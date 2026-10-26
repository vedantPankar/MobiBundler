-- Additive: revenue tracking tables only. Mirrors prisma/migrations/20261025000000_add_revenue_tracking.
CREATE TABLE "OrderRecord" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "currencyCode" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "linesHash" TEXT NOT NULL,
    "linesJson" TEXT NOT NULL,
    "refundsJson" TEXT NOT NULL,
    "attributionJson" TEXT NOT NULL,
    "reconciled" BOOLEAN NOT NULL,
    "reconcileNote" TEXT,
    "unmappedRefundMinor" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderRecord_shop_orderId_key" ON "OrderRecord"("shop", "orderId");
CREATE INDEX "OrderRecord_shop_orderedAt_idx" ON "OrderRecord"("shop", "orderedAt");

CREATE TABLE "BundleOrderRevenue" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "reconciled" BOOLEAN NOT NULL,
    "sets" INTEGER NOT NULL,
    "unitsSold" INTEGER NOT NULL,
    "unitsRefunded" INTEGER NOT NULL,
    "soldGrossMinor" INTEGER NOT NULL,
    "soldDiscountMinor" INTEGER NOT NULL,
    "netMinor" INTEGER NOT NULL,

    CONSTRAINT "BundleOrderRevenue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BundleOrderRevenue_shop_orderId_bundleId_key" ON "BundleOrderRevenue"("shop", "orderId", "bundleId");
CREATE INDEX "BundleOrderRevenue_shop_orderedAt_idx" ON "BundleOrderRevenue"("shop", "orderedAt");
CREATE INDEX "BundleOrderRevenue_shop_bundleId_orderedAt_idx" ON "BundleOrderRevenue"("shop", "bundleId", "orderedAt");

CREATE TABLE "RevenueSyncState" (
    "shop" TEXT NOT NULL,
    "trackingStartedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastOrderUpdatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "RevenueSyncState_pkey" PRIMARY KEY ("shop")
);
