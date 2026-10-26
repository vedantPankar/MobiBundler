-- Additive: machine-readable reason for the last revenue sync failure.
ALTER TABLE "RevenueSyncState" ADD COLUMN "lastErrorCode" TEXT;
