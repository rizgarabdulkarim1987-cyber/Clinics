-- Two kinds of customer (wholesale, market) and a market price per item unit.
CREATE TYPE "WhCustomerType" AS ENUM ('WHOLESALE', 'MARKET');
ALTER TABLE "WhCustomer" ADD COLUMN "type" "WhCustomerType" NOT NULL DEFAULT 'WHOLESALE';
ALTER TABLE "WhPriceListEntry" ADD COLUMN "marketPriceIqd" DECIMAL(24,4);
