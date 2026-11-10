-- AlterTable
ALTER TABLE "AccountEntry" ADD COLUMN "recurringId" TEXT,
ADD COLUMN "recurringMonth" TEXT;

-- CreateTable
CREATE TABLE "AccountRecurring" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "amountMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "startMonth" TEXT NOT NULL,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountRecurring_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountBudget" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "limitMinor" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountBudget_service_currency_key" ON "AccountBudget"("service", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "AccountEntry_recurringId_recurringMonth_key" ON "AccountEntry"("recurringId", "recurringMonth");

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "AccountRecurring"("id") ON DELETE SET NULL ON UPDATE CASCADE;
