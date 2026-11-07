-- CreateTable
CREATE TABLE "ServiceClient" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceClient_secretHash_key" ON "ServiceClient"("secretHash");

-- CreateIndex
CREATE INDEX "ServiceClient_applicationId_idx" ON "ServiceClient"("applicationId");

-- AddForeignKey
ALTER TABLE "ServiceClient" ADD CONSTRAINT "ServiceClient_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
