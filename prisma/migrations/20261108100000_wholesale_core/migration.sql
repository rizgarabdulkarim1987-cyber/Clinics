-- Wholesale inside Core: every table is per company (restaurantId). Generated from the schema, then the hand-written rules.
-- CreateEnum
CREATE TYPE "WhCurrency" AS ENUM ('IQD', 'USD', 'IRT');

-- CreateEnum
CREATE TYPE "WhAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'CONTRA');

-- CreateEnum
CREATE TYPE "WhSide" AS ENUM ('DR', 'CR');

-- CreateEnum
CREATE TYPE "WhPeriodEventKind" AS ENUM ('CLOSE', 'REOPEN');

-- CreateEnum
CREATE TYPE "WhUnit" AS ENUM ('PIECE', 'CARTON', 'TON');

-- CreateEnum
CREATE TYPE "WhWarehouseKind" AS ENUM ('MAIN', 'REP', 'DAMAGE');

-- CreateEnum
CREATE TYPE "WhStockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUST', 'RECOST');

-- CreateEnum
CREATE TYPE "WhPaymentMode" AS ENUM ('CASH', 'CREDIT');

-- CreateEnum
CREATE TYPE "WhPurchaseStatus" AS ENUM ('POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhLandedCostKind" AS ENUM ('SHIPPING', 'CUSTOMS', 'CLEARANCE', 'TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "WhSaleStatus" AS ENUM ('POSTED', 'PENDING_APPROVAL', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhPriceMode" AS ENUM ('OFFICIAL', 'PERCENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "WhReturnCondition" AS ENUM ('GOOD', 'DAMAGED');

-- CreateEnum
CREATE TYPE "WhReturnRefund" AS ENUM ('CASH', 'DEBT_OFFSET');

-- CreateEnum
CREATE TYPE "WhSettlementDirection" AS ENUM ('CUSTOMER_PAYS', 'COMPANY_PAYS', 'NONE');

-- CreateEnum
CREATE TYPE "WhHandoverStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CONFIRMED_SHORT', 'REJECTED');

-- CreateEnum
CREATE TYPE "WhExpenseCategory" AS ENUM ('RENT', 'SALARIES', 'FUEL', 'TRANSPORT', 'UTILITIES', 'OTHER');

-- CreateEnum
CREATE TYPE "WhExpenseStatus" AS ENUM ('PENDING', 'POSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WhExpensePaidFrom" AS ENUM ('CASH', 'CUSTODY');

-- CreateEnum
CREATE TYPE "WhOpeningKind" AS ENUM ('STOCK', 'CUSTOMERS', 'SUPPLIERS', 'CASH');

-- CreateEnum
CREATE TYPE "WhRole" AS ENUM ('OWNER', 'PARTNER', 'REP');

-- CreateTable
CREATE TABLE "WhExchangeRate" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "iqdPer" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhLedgerAccount" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "WhAccountType" NOT NULL,
    "normalSide" "WhSide" NOT NULL,
    "name" JSONB NOT NULL,
    "postable" BOOLEAN NOT NULL DEFAULT true,
    "currency" "WhCurrency",
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhLedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhJournalEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "memo" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reversesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhJournalLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "side" "WhSide" NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "rateIqd" DECIMAL(18,8) NOT NULL,
    "baseIqd" DECIMAL(24,4) NOT NULL,
    "partyId" TEXT,

    CONSTRAINT "WhJournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhPeriodEvent" (
    "id" BIGSERIAL NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "kind" "WhPeriodEventKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhPeriodEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhItem" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "names" JSONB NOT NULL,
    "category" TEXT,
    "baseUnit" "WhUnit" NOT NULL,
    "reorderPoint" DECIMAL(24,8),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhItemUnit" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "unit" "WhUnit" NOT NULL,
    "factorToBase" DECIMAL(24,8) NOT NULL,
    "barcode" TEXT,

    CONSTRAINT "WhItemUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhPriceListEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "unit" "WhUnit" NOT NULL,
    "priceIqd" DECIMAL(24,4) NOT NULL,

    CONSTRAINT "WhPriceListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhCity" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,

    CONSTRAINT "WhCity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhCustomer" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "cityId" TEXT NOT NULL,
    "repId" TEXT,
    "creditLimitIqd" DECIMAL(24,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSupplier" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "country" TEXT,
    "isForeign" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhWarehouse" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "kind" "WhWarehouseKind" NOT NULL,
    "name" TEXT NOT NULL,
    "repUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhStockBalance" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qtyBase" DECIMAL(24,8) NOT NULL,
    "avgCostIqd" DECIMAL(24,8) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhStockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhStockMovement" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "type" "WhStockMovementType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qtyBase" DECIMAL(24,8) NOT NULL,
    "unitCostIqd" DECIMAL(24,8) NOT NULL,
    "qtyAfterBase" DECIMAL(24,8) NOT NULL,
    "avgCostAfterIqd" DECIMAL(24,8) NOT NULL,
    "addedCostIqd" DECIMAL(24,4),
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhBatch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qtyBase" DECIMAL(24,8) NOT NULL,
    "expiry" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhPurchase" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "supplierId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "paymentMode" "WhPaymentMode" NOT NULL,
    "dueDate" DATE,
    "warehouseId" TEXT NOT NULL,
    "rateSnapshot" JSONB NOT NULL,
    "totalOriginal" DECIMAL(24,4) NOT NULL,
    "totalIqd" DECIMAL(24,4) NOT NULL,
    "status" "WhPurchaseStatus" NOT NULL DEFAULT 'POSTED',
    "journalEntryId" TEXT NOT NULL,
    "cancelEntryId" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhPurchaseLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "unit" "WhUnit" NOT NULL,
    "qty" DECIMAL(24,8) NOT NULL,
    "qtyBase" DECIMAL(24,8) NOT NULL,
    "unitPrice" DECIMAL(24,4) NOT NULL,
    "lineTotal" DECIMAL(24,4) NOT NULL,
    "expiry" DATE,
    "unitCostIqd" DECIMAL(24,8) NOT NULL,

    CONSTRAINT "WhPurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhLandedCost" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "kind" "WhLandedCostKind" NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "date" DATE NOT NULL,
    "rateSnapshot" JSONB NOT NULL,
    "amountIqd" DECIMAL(24,4) NOT NULL,
    "paymentMode" "WhPaymentMode" NOT NULL,
    "supplierId" TEXT,
    "journalEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhLandedCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhLandedCostAllocation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "landedCostId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "amountOriginal" DECIMAL(24,4) NOT NULL,
    "iqdToInventory" DECIMAL(24,4) NOT NULL,
    "iqdToCogs" DECIMAL(24,4) NOT NULL,

    CONSTRAINT "WhLandedCostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSupplierPayment" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "landedCostId" TEXT,
    "openingDebtId" TEXT,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "date" DATE NOT NULL,
    "settledInPurchaseCcy" DECIMAL(24,4) NOT NULL,
    "rateSnapshot" JSONB NOT NULL,
    "fxDiffIqd" DECIMAL(24,4) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhSupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSetting" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSale" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" "WhCurrency" NOT NULL,
    "paymentMode" "WhPaymentMode" NOT NULL,
    "dueDate" DATE,
    "warehouseId" TEXT NOT NULL,
    "status" "WhSaleStatus" NOT NULL,
    "rateSnapshot" JSONB NOT NULL,
    "totalOfficial" DECIMAL(24,4) NOT NULL,
    "totalFinal" DECIMAL(24,4) NOT NULL,
    "totalDiscount" DECIMAL(24,4) NOT NULL,
    "totalCostIqd" DECIMAL(24,4),
    "journalEntryId" TEXT,
    "cancelEntryId" TEXT,
    "statusReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "approvedById" TEXT,
    "custodyRepId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSaleLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "unit" "WhUnit" NOT NULL,
    "qty" DECIMAL(24,8) NOT NULL,
    "qtyBase" DECIMAL(24,8) NOT NULL,
    "priceMode" "WhPriceMode" NOT NULL,
    "percent" DECIMAL(7,4),
    "manualPrice" DECIMAL(24,4),
    "officialPriceIqd" DECIMAL(24,4) NOT NULL,
    "officialPrice" DECIMAL(24,4) NOT NULL,
    "finalPrice" DECIMAL(24,4) NOT NULL,
    "discount" DECIMAL(24,4) NOT NULL,
    "lineTotal" DECIMAL(24,4) NOT NULL,
    "unitCostIqd" DECIMAL(24,8),

    CONSTRAINT "WhSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSaleLineBatch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "expiry" DATE,
    "qtyBase" DECIMAL(24,8) NOT NULL,

    CONSTRAINT "WhSaleLineBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhCustomerPayment" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "saleId" TEXT,
    "openingDebtId" TEXT,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "date" DATE NOT NULL,
    "settledInSaleCcy" DECIMAL(24,4) NOT NULL,
    "rateSnapshot" JSONB NOT NULL,
    "fxDiffIqd" DECIMAL(24,4) NOT NULL,
    "receivedByRep" BOOLEAN NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhCustomerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSaleReturn" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "saleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "refund" "WhReturnRefund" NOT NULL,
    "totalValue" DECIMAL(24,4) NOT NULL,
    "totalOfficial" DECIMAL(24,4) NOT NULL,
    "totalCostIqd" DECIMAL(24,4) NOT NULL,
    "damageLossIqd" DECIMAL(24,4) NOT NULL,
    "exchangeSaleId" TEXT,
    "settlementDirection" "WhSettlementDirection" NOT NULL,
    "settlementAmount" DECIMAL(24,4) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhSaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSaleReturnLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "condition" "WhReturnCondition" NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" DECIMAL(24,8) NOT NULL,
    "qtyBase" DECIMAL(24,8) NOT NULL,
    "unitCostIqd" DECIMAL(24,8) NOT NULL,
    "lineOfficial" DECIMAL(24,4) NOT NULL,
    "lineTotal" DECIMAL(24,4) NOT NULL,

    CONSTRAINT "WhSaleReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSaleReturnLineBatch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "returnLineId" TEXT NOT NULL,
    "expiry" DATE,
    "qtyBase" DECIMAL(24,8) NOT NULL,

    CONSTRAINT "WhSaleReturnLineBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSaleReturnOffset" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "rateIqd" DECIMAL(18,8) NOT NULL,
    "fxDiffIqd" DECIMAL(24,4) NOT NULL,

    CONSTRAINT "WhSaleReturnOffset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhCurrencyConversion" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "fromCurrency" "WhCurrency" NOT NULL,
    "fromAmount" DECIMAL(24,4) NOT NULL,
    "fromRateIqd" DECIMAL(18,8) NOT NULL,
    "toCurrency" "WhCurrency" NOT NULL,
    "toAmount" DECIMAL(24,4) NOT NULL,
    "toRateIqd" DECIMAL(18,8) NOT NULL,
    "fxDiffIqd" DECIMAL(24,4) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhCurrencyConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhCustodyHandover" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "repId" TEXT NOT NULL,
    "status" "WhHandoverStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATE,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhCustodyHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhCustodyHandoverLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "submitted" DECIMAL(24,4) NOT NULL,
    "received" DECIMAL(24,4),
    "shortage" DECIMAL(24,4),
    "rateIqd" DECIMAL(18,8),

    CONSTRAINT "WhCustodyHandoverLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhExpense" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "category" "WhExpenseCategory" NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "date" DATE NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "warehouseId" TEXT,
    "paidFrom" "WhExpensePaidFrom" NOT NULL,
    "custodyRepId" TEXT,
    "status" "WhExpenseStatus" NOT NULL,
    "rateIqd" DECIMAL(18,8),
    "amountIqd" DECIMAL(24,4),
    "fxDiffIqd" DECIMAL(24,4),
    "journalEntryId" TEXT,
    "statusReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhOpeningImport" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "kind" "WhOpeningKind" NOT NULL,
    "date" DATE NOT NULL,
    "rows" INTEGER NOT NULL,
    "totalIqd" DECIMAL(24,4) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhOpeningImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhOpeningDebt" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "currency" "WhCurrency" NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "rateIqd" DECIMAL(18,8) NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhOpeningDebt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhStockCount" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "lossIqd" DECIMAL(24,4) NOT NULL,
    "gainIqd" DECIMAL(24,4) NOT NULL,
    "journalEntryId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhStockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhStockCountLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "bookQtyBase" DECIMAL(24,8) NOT NULL,
    "countedBase" DECIMAL(24,8) NOT NULL,
    "diffBase" DECIMAL(24,8) NOT NULL,
    "unitCostIqd" DECIMAL(24,8) NOT NULL,
    "valueIqd" DECIMAL(24,4) NOT NULL,
    "expiry" DATE,

    CONSTRAINT "WhStockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhPurchaseReturn" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "refund" "WhReturnRefund" NOT NULL,
    "rateIqd" DECIMAL(18,8) NOT NULL,
    "totalValue" DECIMAL(24,4) NOT NULL,
    "inventoryIqd" DECIMAL(24,4) NOT NULL,
    "landedLossIqd" DECIMAL(24,4) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhPurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhPurchaseReturnLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "purchaseLineId" TEXT NOT NULL,
    "qty" DECIMAL(24,8) NOT NULL,
    "qtyBase" DECIMAL(24,8) NOT NULL,
    "unitCostIqd" DECIMAL(24,8) NOT NULL,
    "lineTotal" DECIMAL(24,4) NOT NULL,

    CONSTRAINT "WhPurchaseReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhStaff" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WhRole" NOT NULL,
    "warehouseId" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhStaff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhExchangeRate_restaurantId_idx" ON "WhExchangeRate"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhExchangeRate_restaurantId_date_currency_key" ON "WhExchangeRate"("restaurantId", "date", "currency");

-- CreateIndex
CREATE INDEX "WhLedgerAccount_restaurantId_idx" ON "WhLedgerAccount"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhLedgerAccount_restaurantId_code_key" ON "WhLedgerAccount"("restaurantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WhJournalEntry_number_key" ON "WhJournalEntry"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WhJournalEntry_reversesId_key" ON "WhJournalEntry"("reversesId");

-- CreateIndex
CREATE INDEX "WhJournalEntry_sourceType_sourceId_idx" ON "WhJournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "WhJournalEntry_date_idx" ON "WhJournalEntry"("date");

-- CreateIndex
CREATE INDEX "WhJournalEntry_restaurantId_idx" ON "WhJournalEntry"("restaurantId");

-- CreateIndex
CREATE INDEX "WhJournalLine_accountId_idx" ON "WhJournalLine"("accountId");

-- CreateIndex
CREATE INDEX "WhJournalLine_partyId_idx" ON "WhJournalLine"("partyId");

-- CreateIndex
CREATE INDEX "WhJournalLine_restaurantId_idx" ON "WhJournalLine"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhJournalLine_restaurantId_entryId_lineNo_key" ON "WhJournalLine"("restaurantId", "entryId", "lineNo");

-- CreateIndex
CREATE INDEX "WhPeriodEvent_month_id_idx" ON "WhPeriodEvent"("month", "id");

-- CreateIndex
CREATE INDEX "WhPeriodEvent_restaurantId_idx" ON "WhPeriodEvent"("restaurantId");

-- CreateIndex
CREATE INDEX "WhItem_restaurantId_idx" ON "WhItem"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhItem_restaurantId_code_key" ON "WhItem"("restaurantId", "code");

-- CreateIndex
CREATE INDEX "WhItemUnit_restaurantId_idx" ON "WhItemUnit"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhItemUnit_restaurantId_itemId_unit_key" ON "WhItemUnit"("restaurantId", "itemId", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "WhItemUnit_restaurantId_barcode_key" ON "WhItemUnit"("restaurantId", "barcode");

-- CreateIndex
CREATE INDEX "WhPriceListEntry_restaurantId_idx" ON "WhPriceListEntry"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhPriceListEntry_restaurantId_itemId_unit_key" ON "WhPriceListEntry"("restaurantId", "itemId", "unit");

-- CreateIndex
CREATE INDEX "WhCity_restaurantId_idx" ON "WhCity"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhCity_restaurantId_code_key" ON "WhCity"("restaurantId", "code");

-- CreateIndex
CREATE INDEX "WhCustomer_repId_idx" ON "WhCustomer"("repId");

-- CreateIndex
CREATE INDEX "WhCustomer_cityId_idx" ON "WhCustomer"("cityId");

-- CreateIndex
CREATE INDEX "WhCustomer_restaurantId_idx" ON "WhCustomer"("restaurantId");

-- CreateIndex
CREATE INDEX "WhSupplier_restaurantId_idx" ON "WhSupplier"("restaurantId");

-- CreateIndex
CREATE INDEX "WhWarehouse_restaurantId_idx" ON "WhWarehouse"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhWarehouse_restaurantId_id_repUserId_key" ON "WhWarehouse"("restaurantId", "id", "repUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WhWarehouse_restaurantId_repUserId_key" ON "WhWarehouse"("restaurantId", "repUserId");

-- CreateIndex
CREATE INDEX "WhStockBalance_warehouseId_idx" ON "WhStockBalance"("warehouseId");

-- CreateIndex
CREATE INDEX "WhStockBalance_restaurantId_idx" ON "WhStockBalance"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhStockBalance_restaurantId_itemId_warehouseId_key" ON "WhStockBalance"("restaurantId", "itemId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "WhStockMovement_seq_key" ON "WhStockMovement"("seq");

-- CreateIndex
CREATE INDEX "WhStockMovement_itemId_warehouseId_createdAt_seq_idx" ON "WhStockMovement"("itemId", "warehouseId", "createdAt", "seq");

-- CreateIndex
CREATE INDEX "WhStockMovement_refType_refId_idx" ON "WhStockMovement"("refType", "refId");

-- CreateIndex
CREATE INDEX "WhStockMovement_restaurantId_idx" ON "WhStockMovement"("restaurantId");

-- CreateIndex
CREATE INDEX "WhBatch_itemId_warehouseId_expiry_idx" ON "WhBatch"("itemId", "warehouseId", "expiry");

-- CreateIndex
CREATE INDEX "WhBatch_restaurantId_idx" ON "WhBatch"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhPurchase_number_key" ON "WhPurchase"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WhPurchase_journalEntryId_key" ON "WhPurchase"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "WhPurchase_cancelEntryId_key" ON "WhPurchase"("cancelEntryId");

-- CreateIndex
CREATE INDEX "WhPurchase_supplierId_date_idx" ON "WhPurchase"("supplierId", "date");

-- CreateIndex
CREATE INDEX "WhPurchase_date_idx" ON "WhPurchase"("date");

-- CreateIndex
CREATE INDEX "WhPurchase_restaurantId_idx" ON "WhPurchase"("restaurantId");

-- CreateIndex
CREATE INDEX "WhPurchaseLine_restaurantId_idx" ON "WhPurchaseLine"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhPurchaseLine_restaurantId_purchaseId_lineNo_key" ON "WhPurchaseLine"("restaurantId", "purchaseId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "WhLandedCost_journalEntryId_key" ON "WhLandedCost"("journalEntryId");

-- CreateIndex
CREATE INDEX "WhLandedCost_purchaseId_idx" ON "WhLandedCost"("purchaseId");

-- CreateIndex
CREATE INDEX "WhLandedCost_supplierId_idx" ON "WhLandedCost"("supplierId");

-- CreateIndex
CREATE INDEX "WhLandedCost_restaurantId_idx" ON "WhLandedCost"("restaurantId");

-- CreateIndex
CREATE INDEX "WhLandedCostAllocation_restaurantId_idx" ON "WhLandedCostAllocation"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhLandedCostAllocation_restaurantId_landedCostId_lineId_key" ON "WhLandedCostAllocation"("restaurantId", "landedCostId", "lineId");

-- CreateIndex
CREATE INDEX "WhSupplierPayment_supplierId_date_idx" ON "WhSupplierPayment"("supplierId", "date");

-- CreateIndex
CREATE INDEX "WhSupplierPayment_purchaseId_idx" ON "WhSupplierPayment"("purchaseId");

-- CreateIndex
CREATE INDEX "WhSupplierPayment_landedCostId_idx" ON "WhSupplierPayment"("landedCostId");

-- CreateIndex
CREATE INDEX "WhSupplierPayment_openingDebtId_idx" ON "WhSupplierPayment"("openingDebtId");

-- CreateIndex
CREATE INDEX "WhSupplierPayment_journalEntryId_idx" ON "WhSupplierPayment"("journalEntryId");

-- CreateIndex
CREATE INDEX "WhSupplierPayment_restaurantId_idx" ON "WhSupplierPayment"("restaurantId");

-- CreateIndex
CREATE INDEX "WhSetting_restaurantId_idx" ON "WhSetting"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhSetting_restaurantId_key_key" ON "WhSetting"("restaurantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "WhSale_number_key" ON "WhSale"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WhSale_journalEntryId_key" ON "WhSale"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "WhSale_cancelEntryId_key" ON "WhSale"("cancelEntryId");

-- CreateIndex
CREATE INDEX "WhSale_customerId_date_idx" ON "WhSale"("customerId", "date");

-- CreateIndex
CREATE INDEX "WhSale_status_idx" ON "WhSale"("status");

-- CreateIndex
CREATE INDEX "WhSale_date_idx" ON "WhSale"("date");

-- CreateIndex
CREATE INDEX "WhSale_restaurantId_idx" ON "WhSale"("restaurantId");

-- CreateIndex
CREATE INDEX "WhSaleLine_restaurantId_idx" ON "WhSaleLine"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhSaleLine_restaurantId_saleId_lineNo_key" ON "WhSaleLine"("restaurantId", "saleId", "lineNo");

-- CreateIndex
CREATE INDEX "WhSaleLineBatch_saleLineId_idx" ON "WhSaleLineBatch"("saleLineId");

-- CreateIndex
CREATE INDEX "WhSaleLineBatch_restaurantId_idx" ON "WhSaleLineBatch"("restaurantId");

-- CreateIndex
CREATE INDEX "WhCustomerPayment_customerId_date_idx" ON "WhCustomerPayment"("customerId", "date");

-- CreateIndex
CREATE INDEX "WhCustomerPayment_saleId_idx" ON "WhCustomerPayment"("saleId");

-- CreateIndex
CREATE INDEX "WhCustomerPayment_openingDebtId_idx" ON "WhCustomerPayment"("openingDebtId");

-- CreateIndex
CREATE INDEX "WhCustomerPayment_journalEntryId_idx" ON "WhCustomerPayment"("journalEntryId");

-- CreateIndex
CREATE INDEX "WhCustomerPayment_restaurantId_idx" ON "WhCustomerPayment"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhSaleReturn_number_key" ON "WhSaleReturn"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WhSaleReturn_exchangeSaleId_key" ON "WhSaleReturn"("exchangeSaleId");

-- CreateIndex
CREATE UNIQUE INDEX "WhSaleReturn_journalEntryId_key" ON "WhSaleReturn"("journalEntryId");

-- CreateIndex
CREATE INDEX "WhSaleReturn_saleId_idx" ON "WhSaleReturn"("saleId");

-- CreateIndex
CREATE INDEX "WhSaleReturn_date_idx" ON "WhSaleReturn"("date");

-- CreateIndex
CREATE INDEX "WhSaleReturn_restaurantId_idx" ON "WhSaleReturn"("restaurantId");

-- CreateIndex
CREATE INDEX "WhSaleReturnLine_saleLineId_idx" ON "WhSaleReturnLine"("saleLineId");

-- CreateIndex
CREATE INDEX "WhSaleReturnLine_restaurantId_idx" ON "WhSaleReturnLine"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhSaleReturnLine_restaurantId_returnId_lineNo_key" ON "WhSaleReturnLine"("restaurantId", "returnId", "lineNo");

-- CreateIndex
CREATE INDEX "WhSaleReturnLineBatch_returnLineId_idx" ON "WhSaleReturnLineBatch"("returnLineId");

-- CreateIndex
CREATE INDEX "WhSaleReturnLineBatch_restaurantId_idx" ON "WhSaleReturnLineBatch"("restaurantId");

-- CreateIndex
CREATE INDEX "WhSaleReturnOffset_returnId_idx" ON "WhSaleReturnOffset"("returnId");

-- CreateIndex
CREATE INDEX "WhSaleReturnOffset_saleId_idx" ON "WhSaleReturnOffset"("saleId");

-- CreateIndex
CREATE INDEX "WhSaleReturnOffset_restaurantId_idx" ON "WhSaleReturnOffset"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhCurrencyConversion_number_key" ON "WhCurrencyConversion"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WhCurrencyConversion_journalEntryId_key" ON "WhCurrencyConversion"("journalEntryId");

-- CreateIndex
CREATE INDEX "WhCurrencyConversion_date_idx" ON "WhCurrencyConversion"("date");

-- CreateIndex
CREATE INDEX "WhCurrencyConversion_restaurantId_idx" ON "WhCurrencyConversion"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhCustodyHandover_number_key" ON "WhCustodyHandover"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WhCustodyHandover_journalEntryId_key" ON "WhCustodyHandover"("journalEntryId");

-- CreateIndex
CREATE INDEX "WhCustodyHandover_repId_status_idx" ON "WhCustodyHandover"("repId", "status");

-- CreateIndex
CREATE INDEX "WhCustodyHandover_restaurantId_idx" ON "WhCustodyHandover"("restaurantId");

-- CreateIndex
CREATE INDEX "WhCustodyHandoverLine_restaurantId_idx" ON "WhCustodyHandoverLine"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhCustodyHandoverLine_restaurantId_handoverId_currency_key" ON "WhCustodyHandoverLine"("restaurantId", "handoverId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "WhExpense_number_key" ON "WhExpense"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WhExpense_journalEntryId_key" ON "WhExpense"("journalEntryId");

-- CreateIndex
CREATE INDEX "WhExpense_status_idx" ON "WhExpense"("status");

-- CreateIndex
CREATE INDEX "WhExpense_date_idx" ON "WhExpense"("date");

-- CreateIndex
CREATE INDEX "WhExpense_custodyRepId_idx" ON "WhExpense"("custodyRepId");

-- CreateIndex
CREATE INDEX "WhExpense_restaurantId_idx" ON "WhExpense"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhOpeningImport_journalEntryId_key" ON "WhOpeningImport"("journalEntryId");

-- CreateIndex
CREATE INDEX "WhOpeningImport_kind_idx" ON "WhOpeningImport"("kind");

-- CreateIndex
CREATE INDEX "WhOpeningImport_restaurantId_idx" ON "WhOpeningImport"("restaurantId");

-- CreateIndex
CREATE INDEX "WhOpeningDebt_customerId_idx" ON "WhOpeningDebt"("customerId");

-- CreateIndex
CREATE INDEX "WhOpeningDebt_supplierId_idx" ON "WhOpeningDebt"("supplierId");

-- CreateIndex
CREATE INDEX "WhOpeningDebt_restaurantId_idx" ON "WhOpeningDebt"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhOpeningDebt_restaurantId_importId_lineNo_key" ON "WhOpeningDebt"("restaurantId", "importId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "WhStockCount_number_key" ON "WhStockCount"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WhStockCount_journalEntryId_key" ON "WhStockCount"("journalEntryId");

-- CreateIndex
CREATE INDEX "WhStockCount_warehouseId_date_idx" ON "WhStockCount"("warehouseId", "date");

-- CreateIndex
CREATE INDEX "WhStockCount_restaurantId_idx" ON "WhStockCount"("restaurantId");

-- CreateIndex
CREATE INDEX "WhStockCountLine_restaurantId_idx" ON "WhStockCountLine"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhStockCountLine_restaurantId_countId_lineNo_key" ON "WhStockCountLine"("restaurantId", "countId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "WhStockCountLine_restaurantId_countId_itemId_key" ON "WhStockCountLine"("restaurantId", "countId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "WhPurchaseReturn_number_key" ON "WhPurchaseReturn"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WhPurchaseReturn_journalEntryId_key" ON "WhPurchaseReturn"("journalEntryId");

-- CreateIndex
CREATE INDEX "WhPurchaseReturn_purchaseId_idx" ON "WhPurchaseReturn"("purchaseId");

-- CreateIndex
CREATE INDEX "WhPurchaseReturn_date_idx" ON "WhPurchaseReturn"("date");

-- CreateIndex
CREATE INDEX "WhPurchaseReturn_restaurantId_idx" ON "WhPurchaseReturn"("restaurantId");

-- CreateIndex
CREATE INDEX "WhPurchaseReturnLine_purchaseLineId_idx" ON "WhPurchaseReturnLine"("purchaseLineId");

-- CreateIndex
CREATE INDEX "WhPurchaseReturnLine_restaurantId_idx" ON "WhPurchaseReturnLine"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhPurchaseReturnLine_restaurantId_returnId_lineNo_key" ON "WhPurchaseReturnLine"("restaurantId", "returnId", "lineNo");

-- CreateIndex
CREATE INDEX "WhStaff_restaurantId_idx" ON "WhStaff"("restaurantId");

-- CreateIndex
CREATE INDEX "WhStaff_userId_idx" ON "WhStaff"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhStaff_restaurantId_userId_key" ON "WhStaff"("restaurantId", "userId");

-- AddForeignKey
ALTER TABLE "WhExchangeRate" ADD CONSTRAINT "WhExchangeRate_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhLedgerAccount" ADD CONSTRAINT "WhLedgerAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WhLedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhLedgerAccount" ADD CONSTRAINT "WhLedgerAccount_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhJournalEntry" ADD CONSTRAINT "WhJournalEntry_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "WhJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhJournalEntry" ADD CONSTRAINT "WhJournalEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhJournalLine" ADD CONSTRAINT "WhJournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WhJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhJournalLine" ADD CONSTRAINT "WhJournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhLedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhJournalLine" ADD CONSTRAINT "WhJournalLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPeriodEvent" ADD CONSTRAINT "WhPeriodEvent_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhItem" ADD CONSTRAINT "WhItem_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhItemUnit" ADD CONSTRAINT "WhItemUnit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WhItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhItemUnit" ADD CONSTRAINT "WhItemUnit_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPriceListEntry" ADD CONSTRAINT "WhPriceListEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WhItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPriceListEntry" ADD CONSTRAINT "WhPriceListEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCity" ADD CONSTRAINT "WhCity_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustomer" ADD CONSTRAINT "WhCustomer_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "WhCity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustomer" ADD CONSTRAINT "WhCustomer_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSupplier" ADD CONSTRAINT "WhSupplier_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhWarehouse" ADD CONSTRAINT "WhWarehouse_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockBalance" ADD CONSTRAINT "WhStockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WhItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockBalance" ADD CONSTRAINT "WhStockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockBalance" ADD CONSTRAINT "WhStockBalance_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockMovement" ADD CONSTRAINT "WhStockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WhItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockMovement" ADD CONSTRAINT "WhStockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockMovement" ADD CONSTRAINT "WhStockMovement_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhBatch" ADD CONSTRAINT "WhBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WhItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhBatch" ADD CONSTRAINT "WhBatch_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhBatch" ADD CONSTRAINT "WhBatch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchase" ADD CONSTRAINT "WhPurchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "WhSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchase" ADD CONSTRAINT "WhPurchase_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchase" ADD CONSTRAINT "WhPurchase_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchase" ADD CONSTRAINT "WhPurchase_cancelEntryId_fkey" FOREIGN KEY ("cancelEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchase" ADD CONSTRAINT "WhPurchase_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchaseLine" ADD CONSTRAINT "WhPurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "WhPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchaseLine" ADD CONSTRAINT "WhPurchaseLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WhItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchaseLine" ADD CONSTRAINT "WhPurchaseLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhLandedCost" ADD CONSTRAINT "WhLandedCost_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "WhPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhLandedCost" ADD CONSTRAINT "WhLandedCost_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "WhSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhLandedCost" ADD CONSTRAINT "WhLandedCost_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhLandedCost" ADD CONSTRAINT "WhLandedCost_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhLandedCostAllocation" ADD CONSTRAINT "WhLandedCostAllocation_landedCostId_fkey" FOREIGN KEY ("landedCostId") REFERENCES "WhLandedCost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhLandedCostAllocation" ADD CONSTRAINT "WhLandedCostAllocation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "WhPurchaseLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhLandedCostAllocation" ADD CONSTRAINT "WhLandedCostAllocation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSupplierPayment" ADD CONSTRAINT "WhSupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "WhSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSupplierPayment" ADD CONSTRAINT "WhSupplierPayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "WhPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSupplierPayment" ADD CONSTRAINT "WhSupplierPayment_landedCostId_fkey" FOREIGN KEY ("landedCostId") REFERENCES "WhLandedCost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSupplierPayment" ADD CONSTRAINT "WhSupplierPayment_openingDebtId_fkey" FOREIGN KEY ("openingDebtId") REFERENCES "WhOpeningDebt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSupplierPayment" ADD CONSTRAINT "WhSupplierPayment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSupplierPayment" ADD CONSTRAINT "WhSupplierPayment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSetting" ADD CONSTRAINT "WhSetting_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSale" ADD CONSTRAINT "WhSale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "WhCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSale" ADD CONSTRAINT "WhSale_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSale" ADD CONSTRAINT "WhSale_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSale" ADD CONSTRAINT "WhSale_cancelEntryId_fkey" FOREIGN KEY ("cancelEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSale" ADD CONSTRAINT "WhSale_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleLine" ADD CONSTRAINT "WhSaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "WhSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleLine" ADD CONSTRAINT "WhSaleLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WhItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleLine" ADD CONSTRAINT "WhSaleLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleLineBatch" ADD CONSTRAINT "WhSaleLineBatch_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "WhSaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleLineBatch" ADD CONSTRAINT "WhSaleLineBatch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustomerPayment" ADD CONSTRAINT "WhCustomerPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "WhCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustomerPayment" ADD CONSTRAINT "WhCustomerPayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "WhSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustomerPayment" ADD CONSTRAINT "WhCustomerPayment_openingDebtId_fkey" FOREIGN KEY ("openingDebtId") REFERENCES "WhOpeningDebt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustomerPayment" ADD CONSTRAINT "WhCustomerPayment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustomerPayment" ADD CONSTRAINT "WhCustomerPayment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturn" ADD CONSTRAINT "WhSaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "WhSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturn" ADD CONSTRAINT "WhSaleReturn_exchangeSaleId_fkey" FOREIGN KEY ("exchangeSaleId") REFERENCES "WhSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturn" ADD CONSTRAINT "WhSaleReturn_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturn" ADD CONSTRAINT "WhSaleReturn_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturnLine" ADD CONSTRAINT "WhSaleReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "WhSaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturnLine" ADD CONSTRAINT "WhSaleReturnLine_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "WhSaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturnLine" ADD CONSTRAINT "WhSaleReturnLine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturnLine" ADD CONSTRAINT "WhSaleReturnLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturnLineBatch" ADD CONSTRAINT "WhSaleReturnLineBatch_returnLineId_fkey" FOREIGN KEY ("returnLineId") REFERENCES "WhSaleReturnLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturnLineBatch" ADD CONSTRAINT "WhSaleReturnLineBatch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturnOffset" ADD CONSTRAINT "WhSaleReturnOffset_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "WhSaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturnOffset" ADD CONSTRAINT "WhSaleReturnOffset_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "WhSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSaleReturnOffset" ADD CONSTRAINT "WhSaleReturnOffset_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCurrencyConversion" ADD CONSTRAINT "WhCurrencyConversion_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCurrencyConversion" ADD CONSTRAINT "WhCurrencyConversion_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustodyHandover" ADD CONSTRAINT "WhCustodyHandover_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustodyHandover" ADD CONSTRAINT "WhCustodyHandover_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustodyHandoverLine" ADD CONSTRAINT "WhCustodyHandoverLine_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "WhCustodyHandover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCustodyHandoverLine" ADD CONSTRAINT "WhCustodyHandoverLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhExpense" ADD CONSTRAINT "WhExpense_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhExpense" ADD CONSTRAINT "WhExpense_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhExpense" ADD CONSTRAINT "WhExpense_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhOpeningImport" ADD CONSTRAINT "WhOpeningImport_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhOpeningImport" ADD CONSTRAINT "WhOpeningImport_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhOpeningDebt" ADD CONSTRAINT "WhOpeningDebt_importId_fkey" FOREIGN KEY ("importId") REFERENCES "WhOpeningImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhOpeningDebt" ADD CONSTRAINT "WhOpeningDebt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "WhCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhOpeningDebt" ADD CONSTRAINT "WhOpeningDebt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "WhSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhOpeningDebt" ADD CONSTRAINT "WhOpeningDebt_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockCount" ADD CONSTRAINT "WhStockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockCount" ADD CONSTRAINT "WhStockCount_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockCount" ADD CONSTRAINT "WhStockCount_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockCountLine" ADD CONSTRAINT "WhStockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "WhStockCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockCountLine" ADD CONSTRAINT "WhStockCountLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WhItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStockCountLine" ADD CONSTRAINT "WhStockCountLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchaseReturn" ADD CONSTRAINT "WhPurchaseReturn_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "WhPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchaseReturn" ADD CONSTRAINT "WhPurchaseReturn_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchaseReturn" ADD CONSTRAINT "WhPurchaseReturn_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchaseReturnLine" ADD CONSTRAINT "WhPurchaseReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "WhPurchaseReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchaseReturnLine" ADD CONSTRAINT "WhPurchaseReturnLine_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "WhPurchaseLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhPurchaseReturnLine" ADD CONSTRAINT "WhPurchaseReturnLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStaff" ADD CONSTRAINT "WhStaff_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStaff" ADD CONSTRAINT "WhStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhStaff" ADD CONSTRAINT "WhStaff_restaurantId_warehouseId_userId_fkey" FOREIGN KEY ("restaurantId", "warehouseId", "userId") REFERENCES "WhWarehouse"("restaurantId", "id", "repUserId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written rules ported from the Wholesale system migrations (CHECKs, append-only and guard triggers, partial unique indexes).
-- Every table is per company (restaurantId); the single MAIN/DAMAGE warehouse and the opening rows are per company.

-- IQD is implicit (always 1) and never stored; rates must be positive.
ALTER TABLE "WhExchangeRate" ADD CONSTRAINT "WhExchangeRate_iqdPer_positive" CHECK ("iqdPer" > 0);

ALTER TABLE "WhExchangeRate" ADD CONSTRAINT "WhExchangeRate_not_iqd" CHECK ("currency" <> 'IQD');

-- Ledger invariants, enforced even for raw SQL.
ALTER TABLE "WhJournalLine" ADD CONSTRAINT "WhJournalLine_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "WhJournalLine" ADD CONSTRAINT "WhJournalLine_rate_positive" CHECK ("rateIqd" > 0);

ALTER TABLE "WhJournalLine" ADD CONSTRAINT "WhJournalLine_base_positive" CHECK ("baseIqd" > 0);

ALTER TABLE "WhJournalLine" ADD CONSTRAINT "WhJournalLine_iqd_identity"
  CHECK ("currency" <> 'IQD' OR ("rateIqd" = 1 AND "baseIqd" = "amount"));

ALTER TABLE "WhJournalEntry" ADD CONSTRAINT "WhJournalEntry_not_self_reversal" CHECK ("reversesId" IS NULL OR "reversesId" <> "id");

ALTER TABLE "WhPeriodEvent" ADD CONSTRAINT "WhPeriodEvent_month_format" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- The ledger and the period history are append-only: corrections are reversing entries, reopening is a new event.
-- (TRUNCATE is not row-level and is left for wiping a dev/test database.)
CREATE FUNCTION wh_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: % on "%" is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "wh_WhJournalEntry_append_only" BEFORE UPDATE OR DELETE ON "WhJournalEntry"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhJournalLine_append_only" BEFORE UPDATE OR DELETE ON "WhJournalLine"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhPeriodEvent_append_only" BEFORE UPDATE OR DELETE ON "WhPeriodEvent"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

-- Value checks (mirrored in src/domain/catalog.ts)
ALTER TABLE "WhItemUnit" ADD CONSTRAINT "WhItemUnit_factorToBase_positive" CHECK ("factorToBase" > 0);

ALTER TABLE "WhItemUnit" ADD CONSTRAINT "WhItemUnit_barcode_not_blank" CHECK ("barcode" IS NULL OR btrim("barcode") <> '');

ALTER TABLE "WhPriceListEntry" ADD CONSTRAINT "WhPriceListEntry_priceIqd_nonneg" CHECK ("priceIqd" >= 0);

ALTER TABLE "WhItem" ADD CONSTRAINT "WhItem_reorderPoint_nonneg" CHECK ("reorderPoint" IS NULL OR "reorderPoint" >= 0);

ALTER TABLE "WhCustomer" ADD CONSTRAINT "WhCustomer_creditLimitIqd_nonneg" CHECK ("creditLimitIqd" IS NULL OR "creditLimitIqd" >= 0);

-- ---------------------------------------------------------------------------------------------------------------
-- Hand-written (Prisma does not model these). Mirrored in src/server/stock.ts and src/domain/costing.ts.
-- ---------------------------------------------------------------------------------------------------------------

-- Exactly one MAIN and one DAMAGE warehouse (rows are created by the seed), and REP <=> repUserId.
CREATE UNIQUE INDEX "WhWarehouse_single_main_damage" ON "WhWarehouse"("restaurantId", "kind") WHERE "kind" IN ('MAIN', 'DAMAGE');

ALTER TABLE "WhWarehouse" ADD CONSTRAINT "WhWarehouse_rep_has_user" CHECK (("kind" = 'REP') = ("repUserId" IS NOT NULL));

ALTER TABLE "WhWarehouse" ADD CONSTRAINT "WhWarehouse_name_not_blank" CHECK (btrim("name") <> '');

-- Stock can never go negative; costs never negative; batches never negative.
ALTER TABLE "WhStockBalance" ADD CONSTRAINT "WhStockBalance_qtyBase_nonneg" CHECK ("qtyBase" >= 0);

ALTER TABLE "WhStockBalance" ADD CONSTRAINT "WhStockBalance_avgCostIqd_nonneg" CHECK ("avgCostIqd" >= 0);

ALTER TABLE "WhBatch" ADD CONSTRAINT "WhBatch_qtyBase_nonneg" CHECK ("qtyBase" >= 0);

ALTER TABLE "WhStockMovement" ADD CONSTRAINT "WhStockMovement_unitCostIqd_nonneg" CHECK ("unitCostIqd" >= 0);

ALTER TABLE "WhStockMovement" ADD CONSTRAINT "WhStockMovement_after_nonneg" CHECK ("qtyAfterBase" >= 0 AND "avgCostAfterIqd" >= 0);

-- Stock movements are append-only, like the ledger (same trigger function, created in the ledger migration).
CREATE TRIGGER "wh_WhStockMovement_append_only" BEFORE UPDATE OR DELETE ON "WhStockMovement"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

-- ---------------------------------------------------------------------------------------------------------------
-- Hand-written (Prisma does not model these). Mirrored in src/server/posting/purchase.ts.
-- ---------------------------------------------------------------------------------------------------------------

ALTER TABLE "WhPurchase" ADD CONSTRAINT "WhPurchase_totals_pos" CHECK ("totalOriginal" > 0 AND "totalIqd" > 0);

ALTER TABLE "WhPurchase" ADD CONSTRAINT "WhPurchase_due_credit_only" CHECK ("dueDate" IS NULL OR ("paymentMode" = 'CREDIT' AND "dueDate" >= "date"));

ALTER TABLE "WhPurchase" ADD CONSTRAINT "WhPurchase_cancel_fields" CHECK (("status" = 'CANCELLED') = ("cancelEntryId" IS NOT NULL));

ALTER TABLE "WhPurchaseLine" ADD CONSTRAINT "WhPurchaseLine_amounts" CHECK ("qty" > 0 AND "qtyBase" > 0 AND "unitPrice" >= 0 AND "lineTotal" >= 0 AND "unitCostIqd" >= 0);

ALTER TABLE "WhLandedCost" ADD CONSTRAINT "WhLandedCost_amounts_pos" CHECK ("amount" > 0 AND "amountIqd" > 0);

-- A credit landed cost is owed to a payee; a cash one has none.
ALTER TABLE "WhLandedCost" ADD CONSTRAINT "WhLandedCost_payee" CHECK (("paymentMode" = 'CREDIT') = ("supplierId" IS NOT NULL));

ALTER TABLE "WhLandedCostAllocation" ADD CONSTRAINT "WhLandedCostAllocation_nonneg" CHECK ("amountOriginal" >= 0 AND "iqdToInventory" >= 0 AND "iqdToCogs" >= 0);

-- Exactly one payable document per settlement row.
ALTER TABLE "WhSupplierPayment" ADD CONSTRAINT "WhSupplierPayment_one_document" CHECK (("purchaseId" IS NULL) <> ("landedCostId" IS NULL));

ALTER TABLE "WhSupplierPayment" ADD CONSTRAINT "WhSupplierPayment_amounts_pos" CHECK ("amount" > 0 AND "settledInPurchaseCcy" > 0);

-- Purchase documents are append-only like the ledger (only the Purchase header changes, on cancellation).
CREATE TRIGGER "WhPurchase_no_delete" BEFORE DELETE ON "WhPurchase"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhPurchaseLine_append_only" BEFORE UPDATE OR DELETE ON "WhPurchaseLine"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhLandedCost_append_only" BEFORE UPDATE OR DELETE ON "WhLandedCost"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhLandedCostAllocation_append_only" BEFORE UPDATE OR DELETE ON "WhLandedCostAllocation"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhSupplierPayment_append_only" BEFORE UPDATE OR DELETE ON "WhSupplierPayment"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

-- ---------------------------------------------------------------------------------------------------------------
-- Hand-written (Prisma does not model these). Mirrored in src/server/posting/sale.ts.
-- ---------------------------------------------------------------------------------------------------------------

ALTER TABLE "WhSetting" ADD CONSTRAINT "WhSetting_key_not_blank" CHECK (btrim("key") <> '');

ALTER TABLE "WhSale" ADD CONSTRAINT "WhSale_totals" CHECK ("totalFinal" > 0 AND "totalOfficial" >= 0 AND ("totalCostIqd" IS NULL OR "totalCostIqd" >= 0));

ALTER TABLE "WhSale" ADD CONSTRAINT "WhSale_due_credit_only" CHECK ("dueDate" IS NULL OR "paymentMode" = 'CREDIT');

-- Posted (and later cancelled) sales have their entry and their cost; pending and rejected ones have neither.
ALTER TABLE "WhSale" ADD CONSTRAINT "WhSale_posted_fields" CHECK (("status" IN ('POSTED', 'CANCELLED')) = ("journalEntryId" IS NOT NULL) AND ("status" IN ('POSTED', 'CANCELLED')) = ("totalCostIqd" IS NOT NULL));

ALTER TABLE "WhSale" ADD CONSTRAINT "WhSale_cancel_fields" CHECK (("status" = 'CANCELLED') = ("cancelEntryId" IS NOT NULL));

ALTER TABLE "WhSaleLine" ADD CONSTRAINT "WhSaleLine_amounts" CHECK (
  "qty" > 0 AND "qtyBase" > 0 AND "officialPriceIqd" >= 0 AND "officialPrice" >= 0 AND "finalPrice" > 0 AND "lineTotal" > 0
  AND ("unitCostIqd" IS NULL OR "unitCostIqd" >= 0)
  AND ("percent" IS NULL OR ("percent" >= 0 AND "percent" < 100))
  AND ("manualPrice" IS NULL OR "manualPrice" > 0)
  AND ("priceMode" <> 'PERCENT' OR "percent" IS NOT NULL)
  AND ("priceMode" <> 'MANUAL' OR "manualPrice" IS NOT NULL));

ALTER TABLE "WhCustomerPayment" ADD CONSTRAINT "WhCustomerPayment_amounts_pos" CHECK ("amount" > 0 AND "settledInSaleCcy" > 0);

-- Sale status only moves forward: PENDING_APPROVAL -> POSTED | REJECTED, POSTED -> CANCELLED. A rejected or
-- cancelled sale never changes again, and a sale is never deleted.
CREATE FUNCTION wh_sale_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sale rows are never deleted';
  END IF;
  IF OLD."status" = 'PENDING_APPROVAL' AND NEW."status" IN ('PENDING_APPROVAL', 'POSTED', 'REJECTED') THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'POSTED' AND NEW."status" = 'CANCELLED' AND NEW."journalEntryId" = OLD."journalEntryId"
     AND NEW."totalFinal" = OLD."totalFinal" AND NEW."totalCostIqd" = OLD."totalCostIqd" AND NEW."date" = OLD."date" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Sale % cannot change from % to %', OLD."id", OLD."status", NEW."status";
END $$;

CREATE TRIGGER "WhSale_status_guard" BEFORE UPDATE OR DELETE ON "WhSale"
  FOR EACH ROW EXECUTE FUNCTION wh_sale_status_guard();

-- never deleted.
CREATE FUNCTION wh_sale_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (SELECT "status" FROM "WhSale" WHERE "id" = OLD."saleId") = 'PENDING_APPROVAL'
     AND NEW."saleId" = OLD."saleId" AND NEW."itemId" = OLD."itemId" AND NEW."qtyBase" = OLD."qtyBase" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SaleLine rows cannot be changed or deleted once their sale is decided';
END $$;

CREATE TRIGGER "WhSaleLine_guard" BEFORE UPDATE OR DELETE ON "WhSaleLine"
  FOR EACH ROW EXECUTE FUNCTION wh_sale_line_guard();

CREATE TRIGGER "wh_WhCustomerPayment_append_only" BEFORE UPDATE OR DELETE ON "WhCustomerPayment"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

-- ---------------------------------------------------------------------------------------------------------------
-- Hand-written. Mirrored in src/server/posting/sale.ts.
-- ---------------------------------------------------------------------------------------------------------------

ALTER TABLE "WhSaleLineBatch" ADD CONSTRAINT "WhSaleLineBatch_qty_pos" CHECK ("qtyBase" > 0);

CREATE TRIGGER "wh_WhSaleLineBatch_append_only" BEFORE UPDATE OR DELETE ON "WhSaleLineBatch"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

ALTER TABLE "WhSale" ADD CONSTRAINT "WhSale_due_after_date" CHECK ("dueDate" IS NULL OR "dueDate" >= "date");

-- Lines are added only to a sale that is PENDING_APPROVAL. postSale inserts every sale that way (and its lines
-- with it) and moves it to POSTED in the same transaction, so a decided sale can never gain a line.
CREATE OR REPLACE FUNCTION wh_sale_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT "status" FROM "WhSale" WHERE "id" = NEW."saleId") = 'PENDING_APPROVAL' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'SaleLine rows can only be added to a sale that is waiting for approval';
  END IF;
  IF TG_OP = 'UPDATE' AND (SELECT "status" FROM "WhSale" WHERE "id" = OLD."saleId") = 'PENDING_APPROVAL'
     AND NEW."saleId" = OLD."saleId" AND NEW."itemId" = OLD."itemId" AND NEW."qtyBase" = OLD."qtyBase" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SaleLine rows cannot be changed or deleted once their sale is decided';
END $$;

DROP TRIGGER "WhSaleLine_guard" ON "WhSaleLine";

CREATE TRIGGER "WhSaleLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "WhSaleLine"
  FOR EACH ROW EXECUTE FUNCTION wh_sale_line_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- Hand-written (Prisma does not model these). Mirrored in src/server/posting/return.ts.
-- ---------------------------------------------------------------------------------------------------------------

ALTER TABLE "WhSaleReturn" ADD CONSTRAINT "WhSaleReturn_amounts" CHECK (
  "totalValue" > 0 AND "totalOfficial" >= 0 AND "totalCostIqd" >= 0 AND "damageLossIqd" >= 0
  AND "damageLossIqd" <= "totalCostIqd" AND "settlementAmount" >= 0);

ALTER TABLE "WhSaleReturn" ADD CONSTRAINT "WhSaleReturn_settlement" CHECK (("settlementDirection" = 'NONE') = ("settlementAmount" = 0));

-- Without an exchange the company owes the whole return value.
ALTER TABLE "WhSaleReturn" ADD CONSTRAINT "WhSaleReturn_plain_settlement" CHECK (
  "exchangeSaleId" IS NOT NULL OR ("settlementDirection" = 'COMPANY_PAYS' AND "settlementAmount" = "totalValue"));

ALTER TABLE "WhSaleReturn" ADD CONSTRAINT "WhSaleReturn_exchange_other_sale" CHECK ("exchangeSaleId" IS NULL OR "exchangeSaleId" <> "saleId");

ALTER TABLE "WhSaleReturnLine" ADD CONSTRAINT "WhSaleReturnLine_amounts" CHECK (
  "qty" > 0 AND "qtyBase" > 0 AND "unitCostIqd" >= 0 AND "lineOfficial" >= 0 AND "lineTotal" > 0);

ALTER TABLE "WhSaleReturnLineBatch" ADD CONSTRAINT "WhSaleReturnLineBatch_qty_pos" CHECK ("qtyBase" > 0);

ALTER TABLE "WhSaleReturnOffset" ADD CONSTRAINT "WhSaleReturnOffset_amounts" CHECK ("amount" > 0 AND "rateIqd" > 0);

-- All four are append-only, like the ledger.
CREATE TRIGGER "wh_WhSaleReturn_append_only" BEFORE UPDATE OR DELETE ON "WhSaleReturn"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhSaleReturnLine_append_only" BEFORE UPDATE OR DELETE ON "WhSaleReturnLine"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhSaleReturnLineBatch_append_only" BEFORE UPDATE OR DELETE ON "WhSaleReturnLineBatch"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhSaleReturnOffset_append_only" BEFORE UPDATE OR DELETE ON "WhSaleReturnOffset"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

-- A return (and an offset) only ever goes against a POSTED sale; the exchange sale must be POSTED too.
CREATE FUNCTION wh_sale_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "status" FROM "WhSale" WHERE "id" = NEW."saleId") IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'a return needs a posted sale';
  END IF;
  IF NEW."exchangeSaleId" IS NOT NULL AND (SELECT "status" FROM "WhSale" WHERE "id" = NEW."exchangeSaleId") IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'the exchange sale is not posted';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WhSaleReturn_guard" BEFORE INSERT ON "WhSaleReturn"
  FOR EACH ROW EXECUTE FUNCTION wh_sale_return_guard();

-- An offset credits a POSTED credit sale of the return's own customer.
CREATE FUNCTION wh_sale_return_offset_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "WhSale" o JOIN "WhSaleReturn" r ON r."id" = NEW."returnId" JOIN "WhSale" s ON s."id" = r."saleId"
    WHERE o."id" = NEW."saleId" AND o."status" = 'POSTED' AND o."paymentMode" = 'CREDIT' AND o."customerId" = s."customerId"
      AND o."currency" = r."currency") THEN
    RAISE EXCEPTION 'a return offset needs a posted credit sale of the same customer and currency';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WhSaleReturnOffset_guard" BEFORE INSERT ON "WhSaleReturnOffset"
  FOR EACH ROW EXECUTE FUNCTION wh_sale_return_offset_guard();

-- A return line belongs to a line of the returned sale, and all the returns of a sale line together never exceed
-- what it sold (base units).
CREATE FUNCTION wh_sale_return_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sold numeric;
  returned numeric;
BEGIN
  IF (SELECT "saleId" FROM "WhSaleLine" WHERE "id" = NEW."saleLineId") IS DISTINCT FROM (SELECT "saleId" FROM "WhSaleReturn" WHERE "id" = NEW."returnId") THEN
    RAISE EXCEPTION 'the returned line is not a line of the returned sale';
  END IF;
  SELECT "qtyBase" INTO sold FROM "WhSaleLine" WHERE "id" = NEW."saleLineId";
  SELECT COALESCE(SUM("qtyBase"), 0) INTO returned FROM "WhSaleReturnLine" WHERE "saleLineId" = NEW."saleLineId";
  IF returned + NEW."qtyBase" > sold THEN
    RAISE EXCEPTION 'returning more than sale line % sold', NEW."saleLineId";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WhSaleReturnLine_guard" BEFORE INSERT ON "WhSaleReturnLine"
  FOR EACH ROW EXECUTE FUNCTION wh_sale_return_line_guard();

-- Per (sale line, expiry) the returned portions never exceed the portion the line took (lines posted with batch
-- portions; a line without any SaleLineBatch row is only held to its total by the trigger above).
CREATE FUNCTION wh_sale_return_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_id text;
  sold numeric;
  returned numeric;
BEGIN
  SELECT "saleLineId" INTO line_id FROM "WhSaleReturnLine" WHERE "id" = NEW."returnLineId";
  IF NOT EXISTS (SELECT 1 FROM "WhSaleLineBatch" WHERE "saleLineId" = line_id) THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM("qtyBase"), 0) INTO sold FROM "WhSaleLineBatch"
    WHERE "saleLineId" = line_id AND "expiry" IS NOT DISTINCT FROM NEW."expiry";
  SELECT COALESCE(SUM(b."qtyBase"), 0) INTO returned FROM "WhSaleReturnLineBatch" b
    JOIN "WhSaleReturnLine" l ON l."id" = b."returnLineId"
    WHERE l."saleLineId" = line_id AND b."expiry" IS NOT DISTINCT FROM NEW."expiry";
  IF returned + NEW."qtyBase" > sold THEN
    RAISE EXCEPTION 'returning more of expiry % than sale line % took', NEW."expiry", line_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WhSaleReturnLineBatch_guard" BEFORE INSERT ON "WhSaleReturnLineBatch"
  FOR EACH ROW EXECUTE FUNCTION wh_sale_return_batch_guard();

-- Sale status guard, now also: a sale with returns (or that is the exchange of a return) is never cancelled.
CREATE OR REPLACE FUNCTION wh_sale_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sale rows are never deleted';
  END IF;
  IF OLD."status" = 'PENDING_APPROVAL' AND NEW."status" IN ('PENDING_APPROVAL', 'POSTED', 'REJECTED') THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'POSTED' AND NEW."status" = 'CANCELLED' AND NEW."journalEntryId" = OLD."journalEntryId"
     AND NEW."totalFinal" = OLD."totalFinal" AND NEW."totalCostIqd" = OLD."totalCostIqd" AND NEW."date" = OLD."date" THEN
    IF EXISTS (SELECT 1 FROM "WhSaleReturn" WHERE "saleId" = OLD."id" OR "exchangeSaleId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "WhSaleReturnOffset" WHERE "saleId" = OLD."id") THEN
      RAISE EXCEPTION 'Sale % has returns and cannot be cancelled', OLD."id";
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Sale % cannot change from % to %', OLD."id", OLD."status", NEW."status";
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Hand-written (Prisma does not model these). Mirrored in src/server/posting/{conversion,custody,expense}.ts.
-- ---------------------------------------------------------------------------------------------------------------

-- Currency conversions: written once with their journal entry, never changed.
ALTER TABLE "WhCurrencyConversion" ADD CONSTRAINT "WhCurrencyConversion_values" CHECK (
  "fromCurrency" <> "toCurrency" AND "fromAmount" > 0 AND "toAmount" > 0 AND "fromRateIqd" > 0 AND "toRateIqd" > 0
  AND ("fromCurrency" <> 'IQD' OR "fromRateIqd" = 1) AND ("toCurrency" <> 'IQD' OR "toRateIqd" = 1));

CREATE TRIGGER "wh_WhCurrencyConversion_append_only" BEFORE UPDATE OR DELETE ON "WhCurrencyConversion"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

-- Custody handovers.
ALTER TABLE "WhCustodyHandover" ADD CONSTRAINT "WhCustodyHandover_decided" CHECK (
  ("status" = 'PENDING') = ("decidedById" IS NULL) AND ("status" = 'PENDING') = ("decidedAt" IS NULL)
  AND ("status" IN ('CONFIRMED', 'CONFIRMED_SHORT')) = ("date" IS NOT NULL)
  AND ("journalEntryId" IS NULL OR "status" IN ('CONFIRMED', 'CONFIRMED_SHORT'))
  AND ("decidedById" IS NULL OR "decidedById" <> "repId"));

ALTER TABLE "WhCustodyHandoverLine" ADD CONSTRAINT "WhCustodyHandoverLine_amounts" CHECK (
  "submitted" > 0
  AND ("received" IS NULL) = ("shortage" IS NULL)
  -- the rate it was posted at: set when something was received, absent while unsettled
  AND ("received" IS NOT NULL OR "rateIqd" IS NULL) AND ("received" IS NULL OR "received" = 0 OR "rateIqd" IS NOT NULL)
  AND ("received" IS NULL OR ("received" >= 0 AND "shortage" >= 0 AND "received" + "shortage" = "submitted"))
  AND ("rateIqd" IS NULL OR "rateIqd" > 0)
  AND ("currency" <> 'IQD' OR "rateIqd" IS NULL OR "rateIqd" = 1));

-- A handover moves once: PENDING -> CONFIRMED | CONFIRMED_SHORT | REJECTED, and never changes or disappears after.
-- Confirming needs every line settled first (received set), with no shortage for CONFIRMED and some for
-- CONFIRMED_SHORT; a rejected handover's lines stay unsettled.
CREATE FUNCTION wh_custody_handover_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  unsettled integer;
  short numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CustodyHandover rows are never deleted';
  END IF;
  IF OLD."status" <> 'PENDING' OR NEW."status" = 'PENDING' OR NEW."repId" <> OLD."repId"
     OR NEW."number" <> OLD."number" OR NEW."submittedAt" <> OLD."submittedAt" THEN
    RAISE EXCEPTION 'CustodyHandover % cannot change from % to %', OLD."id", OLD."status", NEW."status";
  END IF;
  SELECT count(*) FILTER (WHERE "received" IS NULL), coalesce(sum("shortage"), 0) INTO unsettled, short
    FROM "WhCustodyHandoverLine" WHERE "handoverId" = OLD."id";
  IF NEW."status" = 'REJECTED' AND short = 0 AND unsettled = (SELECT count(*) FROM "WhCustodyHandoverLine" WHERE "handoverId" = OLD."id") THEN
    RETURN NEW;
  END IF;
  IF NEW."status" = 'CONFIRMED' AND unsettled = 0 AND short = 0 THEN
    RETURN NEW;
  END IF;
  IF NEW."status" = 'CONFIRMED_SHORT' AND unsettled = 0 AND short > 0 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CustodyHandover % lines do not match status %', OLD."id", NEW."status";
END $$;

CREATE TRIGGER "WhCustodyHandover_guard" BEFORE UPDATE OR DELETE ON "WhCustodyHandover"
  FOR EACH ROW EXECUTE FUNCTION wh_custody_handover_guard();

-- Lines are added only to a pending handover and settled once (received/shortage/rate set) while it is pending.
CREATE FUNCTION wh_custody_handover_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT "status" FROM "WhCustodyHandover" WHERE "id" = NEW."handoverId") = 'PENDING' AND NEW."received" IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'CustodyHandoverLine rows can only be added, unsettled, to a pending handover';
  END IF;
  IF TG_OP = 'UPDATE' AND (SELECT "status" FROM "WhCustodyHandover" WHERE "id" = OLD."handoverId") = 'PENDING'
     AND OLD."received" IS NULL AND NEW."received" IS NOT NULL AND NEW."handoverId" = OLD."handoverId"
     AND NEW."currency" = OLD."currency" AND NEW."submitted" = OLD."submitted" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CustodyHandoverLine rows cannot be changed or deleted once settled';
END $$;

CREATE TRIGGER "WhCustodyHandoverLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "WhCustodyHandoverLine"
  FOR EACH ROW EXECUTE FUNCTION wh_custody_handover_line_guard();

-- Expenses.
ALTER TABLE "WhExpense" ADD CONSTRAINT "WhExpense_values" CHECK (
  "amount" > 0
  AND ("status" = 'POSTED') = ("journalEntryId" IS NOT NULL)
  AND ("status" = 'POSTED') = ("rateIqd" IS NOT NULL)
  AND ("status" = 'POSTED') = ("amountIqd" IS NOT NULL)
  AND ("status" = 'POSTED') = ("fxDiffIqd" IS NOT NULL)
  AND ("status" = 'PENDING') = ("decidedAt" IS NULL)
  AND ("rateIqd" IS NULL OR "rateIqd" > 0) AND ("amountIqd" IS NULL OR "amountIqd" > 0)
  AND ("currency" <> 'IQD' OR "rateIqd" IS NULL OR "rateIqd" = 1)
  AND ("paidFrom" = 'CUSTODY') = ("custodyRepId" IS NOT NULL)
  AND ("paidFrom" = 'CUSTODY' OR "fxDiffIqd" IS NULL OR "fxDiffIqd" = 0));

-- An expense moves once: PENDING -> POSTED | REJECTED (what was asked for never changes; posting may move the date to
-- the approval day). Inserted PENDING or POSTED; never deleted.
CREATE FUNCTION wh_expense_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Expense rows are never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" IN ('PENDING', 'POSTED') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'an Expense is inserted PENDING or POSTED';
  END IF;
  IF OLD."status" = 'PENDING' AND NEW."status" IN ('POSTED', 'REJECTED')
     AND NEW."number" = OLD."number" AND NEW."category" = OLD."category" AND NEW."amount" = OLD."amount"
     AND NEW."currency" = OLD."currency" AND NEW."paidFrom" = OLD."paidFrom"
     AND NEW."custodyRepId" IS NOT DISTINCT FROM OLD."custodyRepId" AND NEW."userId" = OLD."userId"
     AND NEW."warehouseId" IS NOT DISTINCT FROM OLD."warehouseId" AND NEW."requestedAt" = OLD."requestedAt"
     AND (NEW."status" = 'POSTED' OR NEW."date" = OLD."date") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Expense % cannot change from % to %', OLD."id", OLD."status", NEW."status";
END $$;

CREATE TRIGGER "WhExpense_status_guard" BEFORE INSERT OR UPDATE OR DELETE ON "WhExpense"
  FOR EACH ROW EXECUTE FUNCTION wh_expense_status_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- Hand-written (Prisma does not model these). Mirrored in src/server/import/opening.ts, src/server/stockCount.ts
-- and src/server/posting/purchaseReturn.ts.
-- ---------------------------------------------------------------------------------------------------------------

-- Opening balances
ALTER TABLE "WhOpeningImport" ADD CONSTRAINT "WhOpeningImport_amounts" CHECK ("rows" > 0 AND "totalIqd" > 0);

ALTER TABLE "WhOpeningDebt" ADD CONSTRAINT "WhOpeningDebt_one_party" CHECK (("customerId" IS NULL) <> ("supplierId" IS NULL));

ALTER TABLE "WhOpeningDebt" ADD CONSTRAINT "WhOpeningDebt_amounts" CHECK (
  "amount" > 0 AND "rateIqd" > 0 AND ("currency" <> 'IQD' OR "rateIqd" = 1));

CREATE UNIQUE INDEX "WhOpeningDebt_customer_currency_key" ON "WhOpeningDebt"("restaurantId", "customerId", "currency") WHERE "customerId" IS NOT NULL;

CREATE UNIQUE INDEX "WhOpeningDebt_supplier_currency_key" ON "WhOpeningDebt"("restaurantId", "supplierId", "currency") WHERE "supplierId" IS NOT NULL;

CREATE TRIGGER "wh_WhOpeningImport_append_only" BEFORE UPDATE OR DELETE ON "WhOpeningImport"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhOpeningDebt_append_only" BEFORE UPDATE OR DELETE ON "WhOpeningDebt"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

-- A payment row settles exactly one document; one that settles an opening debt belongs to that debt's party.
ALTER TABLE "WhSupplierPayment" DROP CONSTRAINT "WhSupplierPayment_one_document";

ALTER TABLE "WhSupplierPayment" ADD CONSTRAINT "WhSupplierPayment_one_document" CHECK (num_nonnulls("purchaseId", "landedCostId", "openingDebtId") = 1);

ALTER TABLE "WhCustomerPayment" ADD CONSTRAINT "WhCustomerPayment_one_document" CHECK (num_nonnulls("saleId", "openingDebtId") = 1);

CREATE FUNCTION wh_opening_debt_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."openingDebtId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'CustomerPayment' THEN
    IF (SELECT "customerId" FROM "WhOpeningDebt" WHERE "id" = NEW."openingDebtId") IS DISTINCT FROM NEW."customerId" THEN
      RAISE EXCEPTION 'the opening debt is not owed by this customer';
    END IF;
  ELSE
    IF (SELECT "supplierId" FROM "WhOpeningDebt" WHERE "id" = NEW."openingDebtId") IS DISTINCT FROM NEW."supplierId" THEN
      RAISE EXCEPTION 'the opening debt is not owed to this supplier';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WhCustomerPayment_opening_guard" BEFORE INSERT ON "WhCustomerPayment"
  FOR EACH ROW EXECUTE FUNCTION wh_opening_debt_payment_guard();

CREATE TRIGGER "WhSupplierPayment_opening_guard" BEFORE INSERT ON "WhSupplierPayment"
  FOR EACH ROW EXECUTE FUNCTION wh_opening_debt_payment_guard();

-- Stock counts
ALTER TABLE "WhStockCount" ADD CONSTRAINT "WhStockCount_amounts" CHECK (
  "lossIqd" >= 0 AND "gainIqd" >= 0 AND (("journalEntryId" IS NULL) = ("lossIqd" = 0 AND "gainIqd" = 0)));

ALTER TABLE "WhStockCountLine" ADD CONSTRAINT "WhStockCountLine_amounts" CHECK (
  "bookQtyBase" >= 0 AND "countedBase" >= 0 AND "diffBase" = "countedBase" - "bookQtyBase"
  AND "unitCostIqd" >= 0 AND "valueIqd" >= 0);

CREATE TRIGGER "wh_WhStockCount_append_only" BEFORE UPDATE OR DELETE ON "WhStockCount"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhStockCountLine_append_only" BEFORE UPDATE OR DELETE ON "WhStockCountLine"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

-- The damage warehouse is never counted: its value is already written off (INVENTORY excludes it).
CREATE FUNCTION wh_stock_count_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "kind" FROM "WhWarehouse" WHERE "id" = NEW."warehouseId") = 'DAMAGE' THEN
    RAISE EXCEPTION 'the damage warehouse is not counted';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WhStockCount_guard" BEFORE INSERT ON "WhStockCount"
  FOR EACH ROW EXECUTE FUNCTION wh_stock_count_guard();

-- Purchase returns
ALTER TABLE "WhPurchaseReturn" ADD CONSTRAINT "WhPurchaseReturn_amounts" CHECK (
  "totalValue" > 0 AND "rateIqd" > 0 AND ("currency" <> 'IQD' OR "rateIqd" = 1)
  AND "inventoryIqd" >= 0 AND "landedLossIqd" >= 0 AND "landedLossIqd" <= "inventoryIqd");

ALTER TABLE "WhPurchaseReturnLine" ADD CONSTRAINT "WhPurchaseReturnLine_amounts" CHECK (
  "qty" > 0 AND "qtyBase" > 0 AND "unitCostIqd" >= 0 AND "lineTotal" >= 0);

CREATE TRIGGER "wh_WhPurchaseReturn_append_only" BEFORE UPDATE OR DELETE ON "WhPurchaseReturn"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

CREATE TRIGGER "wh_WhPurchaseReturnLine_append_only" BEFORE UPDATE OR DELETE ON "WhPurchaseReturnLine"
  FOR EACH ROW EXECUTE FUNCTION wh_ledger_append_only();

-- A return goes against a POSTED purchase, in its currency; a debt offset only against a credit purchase.
CREATE FUNCTION wh_purchase_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "WhPurchase" WHERE "id" = NEW."purchaseId" AND "status" = 'POSTED' AND "currency" = NEW."currency"
                 AND (NEW."refund" = 'CASH' OR "paymentMode" = 'CREDIT')) THEN
    RAISE EXCEPTION 'a purchase return needs a posted purchase in its currency (a debt offset: a credit purchase)';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WhPurchaseReturn_guard" BEFORE INSERT ON "WhPurchaseReturn"
  FOR EACH ROW EXECUTE FUNCTION wh_purchase_return_guard();

-- A return line is a line of the returned purchase, and all the returns of a line never exceed what it bought.
CREATE FUNCTION wh_purchase_return_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bought numeric;
  returned numeric;
BEGIN
  IF (SELECT "purchaseId" FROM "WhPurchaseLine" WHERE "id" = NEW."purchaseLineId") IS DISTINCT FROM (SELECT "purchaseId" FROM "WhPurchaseReturn" WHERE "id" = NEW."returnId") THEN
    RAISE EXCEPTION 'the returned line is not a line of the returned purchase';
  END IF;
  SELECT "qtyBase" INTO bought FROM "WhPurchaseLine" WHERE "id" = NEW."purchaseLineId";
  SELECT COALESCE(SUM("qtyBase"), 0) INTO returned FROM "WhPurchaseReturnLine" WHERE "purchaseLineId" = NEW."purchaseLineId";
  IF returned + NEW."qtyBase" > bought THEN
    RAISE EXCEPTION 'returning more than purchase line % bought', NEW."purchaseLineId";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WhPurchaseReturnLine_guard" BEFORE INSERT ON "WhPurchaseReturnLine"
  FOR EACH ROW EXECUTE FUNCTION wh_purchase_return_line_guard();

-- A purchase with returns is never cancelled.
CREATE FUNCTION wh_purchase_cancel_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'POSTED' AND NEW."status" = 'CANCELLED' AND EXISTS (SELECT 1 FROM "WhPurchaseReturn" WHERE "purchaseId" = OLD."id") THEN
    RAISE EXCEPTION 'Purchase % has returns and cannot be cancelled', OLD."id";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WhPurchase_cancel_guard" BEFORE UPDATE ON "WhPurchase"
  FOR EACH ROW EXECUTE FUNCTION wh_purchase_cancel_guard();

-- STOCK once
CREATE UNIQUE INDEX "WhOpeningImport_stock_once" ON "WhOpeningImport"("restaurantId", "kind") WHERE "kind" = 'STOCK';

-- Once a sale has left PENDING_APPROVAL its custody rep never changes.
CREATE FUNCTION wh_sale_custody_rep_pin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'PENDING_APPROVAL' AND NEW."custodyRepId" IS DISTINCT FROM OLD."custodyRepId" THEN
    RAISE EXCEPTION 'Sale % custodyRepId cannot change after posting', OLD."id";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WhSale_custody_rep_pin" BEFORE UPDATE ON "WhSale"
  FOR EACH ROW EXECUTE FUNCTION wh_sale_custody_rep_pin();
