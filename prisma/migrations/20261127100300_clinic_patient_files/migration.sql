-- Photos and documents of one patient, kept private in the database.
CREATE TABLE "ClPatientFile" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClPatientFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClPatientFile_restaurantId_patientId_idx" ON "ClPatientFile"("restaurantId", "patientId");
