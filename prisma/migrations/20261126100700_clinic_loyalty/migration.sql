-- CreateEnum
CREATE TYPE "ClLoyaltyKind" AS ENUM ('VISIT', 'REFERRAL', 'REDEEM');

-- AlterTable
ALTER TABLE "ClSettings" ADD COLUMN "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "loyaltyEvery" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "loyaltyRewardIqd" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN "referralStamps" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ClPatient" ADD COLUMN "referredById" TEXT;

-- CreateTable
CREATE TABLE "ClLoyaltyEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "kind" "ClLoyaltyKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "refKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClLoyaltyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClLoyaltyEntry_restaurantId_refKey_key" ON "ClLoyaltyEntry"("restaurantId", "refKey");

-- CreateIndex
CREATE INDEX "ClLoyaltyEntry_restaurantId_householdId_idx" ON "ClLoyaltyEntry"("restaurantId", "householdId");

-- AddForeignKey
ALTER TABLE "ClLoyaltyEntry" ADD CONSTRAINT "ClLoyaltyEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
