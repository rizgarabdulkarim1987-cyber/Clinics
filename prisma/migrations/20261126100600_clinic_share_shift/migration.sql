-- CreateEnum
CREATE TYPE "ClShareMode" AS ENUM ('PERCENT', 'FIXED', 'RENT');

-- CreateEnum
CREATE TYPE "ClShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "ClDoctor" ADD COLUMN "shareMode" "ClShareMode" NOT NULL DEFAULT 'PERCENT',
ADD COLUMN "shareValue" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ClPayment" ADD COLUMN "shiftId" TEXT;

-- CreateTable
CREATE TABLE "ClShift" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "status" "ClShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" TEXT NOT NULL,
    "closedById" TEXT,
    "openingIqd" INTEGER NOT NULL DEFAULT 0,
    "expectedIqd" INTEGER,
    "expectedUsd" INTEGER,
    "countedIqd" INTEGER,
    "countedUsd" INTEGER,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ClShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClShift_restaurantId_status_idx" ON "ClShift"("restaurantId", "status");

-- Only one open shift per clinic, whatever two clicks at once do.
CREATE UNIQUE INDEX "ClShift_one_open_per_clinic" ON "ClShift"("restaurantId") WHERE "status" = 'OPEN';

-- CreateIndex
CREATE INDEX "ClPayment_shiftId_idx" ON "ClPayment"("shiftId");

-- AddForeignKey
ALTER TABLE "ClShift" ADD CONSTRAINT "ClShift_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClPayment" ADD CONSTRAINT "ClPayment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ClShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
