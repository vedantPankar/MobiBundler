-- Additive: the merchant-visible order number (e.g. #1001), which is not customer data.
ALTER TABLE "OrderRecord" ADD COLUMN "orderName" TEXT;
