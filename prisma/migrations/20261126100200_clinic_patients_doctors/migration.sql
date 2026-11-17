-- CreateTable
CREATE TABLE "ClHousehold" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClHousehold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClPatient" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "birthYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClPatient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClDoctor" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "speciality" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClDoctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClDoctorHours" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,

    CONSTRAINT "ClDoctorHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClDoctorFee" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ClDoctorFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClHousehold_restaurantId_phone_key" ON "ClHousehold"("restaurantId", "phone");

-- CreateIndex
CREATE INDEX "ClPatient_restaurantId_name_idx" ON "ClPatient"("restaurantId", "name");

-- CreateIndex
CREATE INDEX "ClPatient_restaurantId_phone_idx" ON "ClPatient"("restaurantId", "phone");

-- CreateIndex
CREATE INDEX "ClPatient_householdId_idx" ON "ClPatient"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "ClDoctor_memberId_key" ON "ClDoctor"("memberId");

-- CreateIndex
CREATE INDEX "ClDoctor_restaurantId_idx" ON "ClDoctor"("restaurantId");

-- CreateIndex
CREATE INDEX "ClDoctorHours_doctorId_idx" ON "ClDoctorHours"("doctorId");

-- CreateIndex
CREATE INDEX "ClDoctorFee_doctorId_idx" ON "ClDoctorFee"("doctorId");

-- CreateIndex
CREATE INDEX "ClDoctorHours_restaurantId_idx" ON "ClDoctorHours"("restaurantId");

-- CreateIndex
CREATE INDEX "ClDoctorFee_restaurantId_idx" ON "ClDoctorFee"("restaurantId");

-- AddForeignKey
ALTER TABLE "ClHousehold" ADD CONSTRAINT "ClHousehold_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClPatient" ADD CONSTRAINT "ClPatient_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClPatient" ADD CONSTRAINT "ClPatient_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "ClHousehold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClDoctor" ADD CONSTRAINT "ClDoctor_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClDoctor" ADD CONSTRAINT "ClDoctor_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ClMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClDoctorHours" ADD CONSTRAINT "ClDoctorHours_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "ClDoctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClDoctorFee" ADD CONSTRAINT "ClDoctorFee_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "ClDoctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
