-- CreateEnum
CREATE TYPE "ClAccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ClRole" AS ENUM ('OWNER', 'RECEPTION', 'DOCTOR', 'CASHIER');

-- CreateEnum
CREATE TYPE "ClMemberStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "ClAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "ClAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "failedSignIns" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClMember" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "role" "ClRole" NOT NULL,
    "branchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ClMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClAccount_email_key" ON "ClAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClSession_tokenHash_key" ON "ClSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ClSession_accountId_idx" ON "ClSession"("accountId");

-- CreateIndex
CREATE INDEX "ClMember_restaurantId_idx" ON "ClMember"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "ClMember_accountId_restaurantId_key" ON "ClMember"("accountId", "restaurantId");

-- AddForeignKey
ALTER TABLE "ClSession" ADD CONSTRAINT "ClSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ClAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClMember" ADD CONSTRAINT "ClMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ClAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClMember" ADD CONSTRAINT "ClMember_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
