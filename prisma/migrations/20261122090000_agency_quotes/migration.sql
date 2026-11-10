-- CreateEnum
CREATE TYPE "AccountQuoteStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "AccountQuote" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "amountMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "issuedOn" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "status" "AccountQuoteStatus" NOT NULL DEFAULT 'OPEN',
    "entryId" TEXT,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountQuote_number_key" ON "AccountQuote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "AccountQuote_entryId_key" ON "AccountQuote"("entryId");

-- CreateIndex
CREATE INDEX "AccountQuote_clientId_idx" ON "AccountQuote"("clientId");

-- AddForeignKey
ALTER TABLE "AccountQuote" ADD CONSTRAINT "AccountQuote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AccountClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountQuote" ADD CONSTRAINT "AccountQuote_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AccountEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
