-- AlterTable
ALTER TABLE "AccountRecurring" ADD COLUMN "kind" "AccountKind" NOT NULL DEFAULT 'EXPENSE',
ADD COLUMN "clientId" TEXT;

-- AddForeignKey
ALTER TABLE "AccountRecurring" ADD CONSTRAINT "AccountRecurring_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AccountClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
