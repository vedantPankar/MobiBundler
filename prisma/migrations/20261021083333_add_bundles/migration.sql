-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'fixed',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "pricingKind" TEXT NOT NULL,
    "pricingValue" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "syncError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BundleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BundleItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BundleEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ShopDiscount" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "shopifyDiscountId" TEXT,
    "configHash" TEXT,
    "syncedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "Bundle_shop_status_idx" ON "Bundle"("shop", "status");

-- CreateIndex
CREATE INDEX "Bundle_shop_updatedAt_idx" ON "Bundle"("shop", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bundle_shop_name_key" ON "Bundle"("shop", "name");

-- CreateIndex
CREATE INDEX "BundleItem_shop_variantId_idx" ON "BundleItem"("shop", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "BundleItem_bundleId_variantId_key" ON "BundleItem"("bundleId", "variantId");

-- CreateIndex
CREATE INDEX "BundleEvent_shop_bundleId_type_createdAt_idx" ON "BundleEvent"("shop", "bundleId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BundleEvent_shop_dedupeKey_key" ON "BundleEvent"("shop", "dedupeKey");
