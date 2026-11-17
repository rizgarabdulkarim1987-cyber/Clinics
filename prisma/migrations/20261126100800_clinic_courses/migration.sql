-- CreateTable
CREATE TABLE "ClPackage" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClPatientPackage" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "billId" TEXT,
    "name" TEXT NOT NULL,
    "sessionsTotal" INTEGER NOT NULL,
    "sessionsLeft" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClPatientPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClPackage_restaurantId_idx" ON "ClPackage"("restaurantId");

-- CreateIndex
CREATE INDEX "ClPatientPackage_restaurantId_patientId_idx" ON "ClPatientPackage"("restaurantId", "patientId");

-- AddForeignKey
ALTER TABLE "ClPackage" ADD CONSTRAINT "ClPackage_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClPatientPackage" ADD CONSTRAINT "ClPatientPackage_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClPatientPackage" ADD CONSTRAINT "ClPatientPackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ClPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClPatientPackage" ADD CONSTRAINT "ClPatientPackage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "ClPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
