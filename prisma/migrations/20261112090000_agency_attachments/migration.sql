-- CreateTable
CREATE TABLE "AccountAttachment" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountAttachment_entryId_idx" ON "AccountAttachment"("entryId");

-- AddForeignKey
ALTER TABLE "AccountAttachment" ADD CONSTRAINT "AccountAttachment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AccountEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
