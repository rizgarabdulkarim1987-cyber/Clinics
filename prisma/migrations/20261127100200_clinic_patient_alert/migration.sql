-- A short clinical alert per patient, readable only by doctors.
CREATE TABLE "ClPatientAlert" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClPatientAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClPatientAlert_patientId_key" ON "ClPatientAlert"("patientId");
CREATE INDEX "ClPatientAlert_restaurantId_idx" ON "ClPatientAlert"("restaurantId");
