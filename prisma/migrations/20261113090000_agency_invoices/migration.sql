-- CreateTable
CREATE TABLE "AccountInvoice" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "entryId" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountInvoice_number_key" ON "AccountInvoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "AccountInvoice_entryId_key" ON "AccountInvoice"("entryId");

-- AddForeignKey
ALTER TABLE "AccountInvoice" ADD CONSTRAINT "AccountInvoice_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AccountEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
