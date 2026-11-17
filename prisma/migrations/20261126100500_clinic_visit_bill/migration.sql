-- CreateEnum
CREATE TYPE "ClBillStatus" AS ENUM ('OPEN', 'PAID', 'DEBT');

-- AlterTable
ALTER TABLE "ClSettings" ADD COLUMN "usdRate" INTEGER NOT NULL DEFAULT 1500;

-- CreateTable
CREATE TABLE "ClVisit" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "complaint" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClBill" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "status" "ClBillStatus" NOT NULL DEFAULT 'OPEN',
    "total" INTEGER NOT NULL DEFAULT 0,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "dueDay" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ClBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClBillLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ClBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClPayment" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "tendered" INTEGER NOT NULL,
    "rate" INTEGER NOT NULL,
    "appliedIqd" INTEGER NOT NULL,
    "changeIqd" INTEGER NOT NULL DEFAULT 0,
    "takenById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClVisit_ticketId_key" ON "ClVisit"("ticketId");

-- CreateIndex
CREATE INDEX "ClVisit_restaurantId_patientId_idx" ON "ClVisit"("restaurantId", "patientId");

-- CreateIndex
CREATE INDEX "ClVisit_doctorId_idx" ON "ClVisit"("doctorId");

-- CreateIndex
CREATE UNIQUE INDEX "ClBill_ticketId_key" ON "ClBill"("ticketId");

-- CreateIndex
CREATE INDEX "ClBill_restaurantId_status_idx" ON "ClBill"("restaurantId", "status");

-- CreateIndex
CREATE INDEX "ClBill_patientId_idx" ON "ClBill"("patientId");

-- CreateIndex
CREATE INDEX "ClBillLine_billId_idx" ON "ClBillLine"("billId");

-- CreateIndex
CREATE INDEX "ClPayment_billId_idx" ON "ClPayment"("billId");

-- CreateIndex
CREATE INDEX "ClPayment_restaurantId_createdAt_idx" ON "ClPayment"("restaurantId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClVisit" ADD CONSTRAINT "ClVisit_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClVisit" ADD CONSTRAINT "ClVisit_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ClTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClVisit" ADD CONSTRAINT "ClVisit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "ClPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClVisit" ADD CONSTRAINT "ClVisit_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "ClDoctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClBill" ADD CONSTRAINT "ClBill_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClBill" ADD CONSTRAINT "ClBill_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ClTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClBill" ADD CONSTRAINT "ClBill_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "ClPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClBill" ADD CONSTRAINT "ClBill_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "ClDoctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClBillLine" ADD CONSTRAINT "ClBillLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClBillLine" ADD CONSTRAINT "ClBillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ClBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClPayment" ADD CONSTRAINT "ClPayment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClPayment" ADD CONSTRAINT "ClPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ClBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
