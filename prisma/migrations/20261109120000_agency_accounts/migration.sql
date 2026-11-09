-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "AccountClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountEntry" (
    "id" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "clientId" TEXT,
    "service" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "occurredOn" DATE NOT NULL,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountClient_slug_key" ON "AccountClient"("slug");

-- CreateIndex
CREATE INDEX "AccountEntry_occurredOn_idx" ON "AccountEntry"("occurredOn");

-- CreateIndex
CREATE INDEX "AccountEntry_clientId_occurredOn_idx" ON "AccountEntry"("clientId", "occurredOn");

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AccountClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

