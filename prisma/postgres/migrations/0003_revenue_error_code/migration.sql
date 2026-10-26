-- Additive: mirrors prisma/migrations/20261025010000_revenue_error_code.
ALTER TABLE "RevenueSyncState" ADD COLUMN "lastErrorCode" TEXT;
