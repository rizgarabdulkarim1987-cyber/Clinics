-- Agency orders: the company imports or sells on behalf of another company (the principal, an existing customer),
-- takes advances, and keeps a commission. Three new ledger accounts carry the money.

-- CreateEnum
CREATE TYPE "WhAgencyStatus" AS ENUM ('OPEN', 'DELIVERED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhAgencyMovementKind" AS ENUM ('ADVANCE', 'COST', 'COMMISSION', 'APPLIED', 'REFUND', 'COLLECTION');

-- CreateTable
CREATE TABLE "WhAgencyOrder" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "principalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "currency" "WhCurrency" NOT NULL,
    "agreedTotal" DECIMAL(24,4) NOT NULL,
    "status" "WhAgencyStatus" NOT NULL DEFAULT 'OPEN',
    "date" DATE NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhAgencyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhAgencyMovement" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "WhAgencyMovementKind" NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" "WhCurrency" NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "custodyRepId" TEXT,
    "journalEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhAgencyMovement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WhAgencyMovement_amount_positive" CHECK ("amount" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "WhAgencyOrder_number_key" ON "WhAgencyOrder"("number");
CREATE INDEX "WhAgencyOrder_restaurantId_status_idx" ON "WhAgencyOrder"("restaurantId", "status");
CREATE INDEX "WhAgencyOrder_principalId_idx" ON "WhAgencyOrder"("principalId");
CREATE INDEX "WhAgencyMovement_orderId_date_idx" ON "WhAgencyMovement"("orderId", "date");
CREATE INDEX "WhAgencyMovement_journalEntryId_idx" ON "WhAgencyMovement"("journalEntryId");
CREATE INDEX "WhAgencyMovement_restaurantId_idx" ON "WhAgencyMovement"("restaurantId");

-- AddForeignKey
ALTER TABLE "WhAgencyOrder" ADD CONSTRAINT "WhAgencyOrder_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhAgencyOrder" ADD CONSTRAINT "WhAgencyOrder_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "WhCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhAgencyMovement" ADD CONSTRAINT "WhAgencyMovement_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhAgencyMovement" ADD CONSTRAINT "WhAgencyMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WhAgencyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhAgencyMovement" ADD CONSTRAINT "WhAgencyMovement_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "WhJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the three accounts for every company that already has a chart of accounts.
INSERT INTO "WhLedgerAccount" ("id", "restaurantId", "code", "type", "normalSide", "name", "postable", "updatedAt")
SELECT gen_random_uuid()::text, r."restaurantId", a."code", a."type"::"WhAccountType", a."side"::"WhSide", a."name"::jsonb, true, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "restaurantId" FROM "WhLedgerAccount") r
CROSS JOIN (VALUES
  ('CUSTOMER_ADVANCES', 'LIABILITY', 'CR', '{"ckb":"پێشەکی کڕیاران","ar":"دفعات مقدمة من العملاء","en":"Customer advances"}'),
  ('AGENCY_RECEIVABLE', 'ASSET', 'DR', '{"ckb":"قەرزی لای ئەو کۆمپانیایانەی بۆیان دەکڕین","ar":"مستحقات الوكالة على الموكلين","en":"Agency receivable"}'),
  ('AGENCY_COMMISSION', 'INCOME', 'CR', '{"ckb":"کۆمیسیۆنی بەرەڵاکردن","ar":"عمولة الوكالة","en":"Agency commission"}')
) AS a("code", "type", "side", "name")
ON CONFLICT ("restaurantId", "code") DO NOTHING;
