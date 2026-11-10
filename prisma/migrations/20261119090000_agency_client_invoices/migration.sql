-- CreateTable
CREATE TABLE "AccountClientInvoice" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountClientInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountClientInvoice_number_key" ON "AccountClientInvoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "AccountClientInvoice_clientId_period_key" ON "AccountClientInvoice"("clientId", "period");

-- AddForeignKey
ALTER TABLE "AccountClientInvoice" ADD CONSTRAINT "AccountClientInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AccountClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
