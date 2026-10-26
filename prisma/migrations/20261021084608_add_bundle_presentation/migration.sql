-- Additive: storefront presentation settings. Hand-written ADD COLUMN (instead of Prisma's table redefinition)
-- so existing Bundle/BundleItem rows are never rebuilt or dropped.
ALTER TABLE "Bundle" ADD COLUMN "buttonLabel" TEXT;
ALTER TABLE "Bundle" ADD COLUMN "showSavings" BOOLEAN NOT NULL DEFAULT true;
