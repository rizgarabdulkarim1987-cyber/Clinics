-- CreateEnum
CREATE TYPE "ClBookingStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'DONE', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ClBookingSource" AS ENUM ('STAFF', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ClWaitlistStatus" AS ENUM ('WAITING', 'BOOKED', 'REMOVED');

-- CreateTable
CREATE TABLE "ClService" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 15,
    "depositAmount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClBooking" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "serviceId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ClBookingStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "ClBookingSource" NOT NULL DEFAULT 'STAFF',
    "depositAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClWaitlistEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "day" TEXT NOT NULL,
    "status" "ClWaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClWaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClService_restaurantId_idx" ON "ClService"("restaurantId");

-- CreateIndex
CREATE INDEX "ClBooking_restaurantId_startsAt_idx" ON "ClBooking"("restaurantId", "startsAt");

-- CreateIndex
CREATE INDEX "ClBooking_doctorId_startsAt_idx" ON "ClBooking"("doctorId", "startsAt");

-- CreateIndex
CREATE INDEX "ClBooking_patientId_idx" ON "ClBooking"("patientId");

-- A doctor's live bookings never share a start: closes the race between two desks that the overlap check alone cannot.
CREATE UNIQUE INDEX "ClBooking_doctor_start_live" ON "ClBooking"("doctorId", "startsAt") WHERE "status" IN ('BOOKED', 'CHECKED_IN');

-- CreateIndex
CREATE INDEX "ClWaitlistEntry_restaurantId_day_idx" ON "ClWaitlistEntry"("restaurantId", "day");

-- AddForeignKey
ALTER TABLE "ClService" ADD CONSTRAINT "ClService_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClBooking" ADD CONSTRAINT "ClBooking_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClBooking" ADD CONSTRAINT "ClBooking_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "ClDoctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClBooking" ADD CONSTRAINT "ClBooking_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "ClPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClBooking" ADD CONSTRAINT "ClBooking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ClService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClWaitlistEntry" ADD CONSTRAINT "ClWaitlistEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClWaitlistEntry" ADD CONSTRAINT "ClWaitlistEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "ClPatient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
