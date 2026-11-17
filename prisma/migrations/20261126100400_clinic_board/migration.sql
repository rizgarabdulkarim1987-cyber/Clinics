-- CreateEnum
CREATE TYPE "ClDistribution" AS ENUM ('SHORTEST_WAIT', 'OWN_DOCTOR', 'SPECIALITY', 'TURN');

-- CreateEnum
CREATE TYPE "ClTicketStatus" AS ENUM ('WAITING', 'WITH_DOCTOR', 'TO_PAY', 'DONE', 'LEFT');

-- AlterTable
ALTER TABLE "ClSettings" ADD COLUMN "distribution" "ClDistribution" NOT NULL DEFAULT 'SHORTEST_WAIT',
ADD COLUMN "lastTurnDoctorId" TEXT;

-- CreateTable
CREATE TABLE "ClTicket" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "bookingId" TEXT,
    "status" "ClTicketStatus" NOT NULL DEFAULT 'WAITING',
    "handedFromDoctorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ClTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClTicket_restaurantId_day_number_key" ON "ClTicket"("restaurantId", "day", "number");

-- CreateIndex
CREATE INDEX "ClTicket_restaurantId_day_status_idx" ON "ClTicket"("restaurantId", "day", "status");

-- CreateIndex
CREATE INDEX "ClTicket_doctorId_day_idx" ON "ClTicket"("doctorId", "day");

-- AddForeignKey
ALTER TABLE "ClTicket" ADD CONSTRAINT "ClTicket_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClTicket" ADD CONSTRAINT "ClTicket_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "ClPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClTicket" ADD CONSTRAINT "ClTicket_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "ClDoctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
