-- Additive: revenue tracking tables only. No existing table is altered.
CREATE TABLE "OrderRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderedAt" DATETIME NOT NULL,
    "cancelledAt" DATETIME,
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
    "syncedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "OrderRecord_shop_orderId_key" ON "OrderRecord"("shop", "orderId");
CREATE INDEX "OrderRecord_shop_orderedAt_idx" ON "OrderRecord"("shop", "orderedAt");

CREATE TABLE "BundleOrderRevenue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "orderedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "reconciled" BOOLEAN NOT NULL,
    "sets" INTEGER NOT NULL,
    "unitsSold" INTEGER NOT NULL,
    "unitsRefunded" INTEGER NOT NULL,
    "soldGrossMinor" INTEGER NOT NULL,
    "soldDiscountMinor" INTEGER NOT NULL,
    "netMinor" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "BundleOrderRevenue_shop_orderId_bundleId_key" ON "BundleOrderRevenue"("shop", "orderId", "bundleId");
CREATE INDEX "BundleOrderRevenue_shop_orderedAt_idx" ON "BundleOrderRevenue"("shop", "orderedAt");
CREATE INDEX "BundleOrderRevenue_shop_bundleId_orderedAt_idx" ON "BundleOrderRevenue"("shop", "bundleId", "orderedAt");

CREATE TABLE "RevenueSyncState" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "trackingStartedAt" DATETIME NOT NULL,
    "lastSyncedAt" DATETIME,
    "lastOrderUpdatedAt" DATETIME,
    "lastError" TEXT,
    "lastErrorAt" DATETIME
);
