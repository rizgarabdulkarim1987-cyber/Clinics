-- Days a doctor is away: no free times and no walk-ins on those days.
CREATE TABLE "ClDoctorLeave" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "fromDay" TEXT NOT NULL,
    "toDay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClDoctorLeave_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClDoctorLeave_doctorId_fromDay_idx" ON "ClDoctorLeave"("doctorId", "fromDay");
CREATE INDEX "ClDoctorLeave_restaurantId_idx" ON "ClDoctorLeave"("restaurantId");

ALTER TABLE "ClDoctorLeave" ADD CONSTRAINT "ClDoctorLeave_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "ClDoctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
