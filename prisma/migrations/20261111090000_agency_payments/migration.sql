-- AlterTable
ALTER TABLE "AccountEntry" ADD COLUMN "owed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AccountPayment" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountPayment_entryId_idx" ON "AccountPayment"("entryId");

-- AddForeignKey
ALTER TABLE "AccountPayment" ADD CONSTRAINT "AccountPayment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AccountEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
