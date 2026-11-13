-- CreateTable
CREATE TABLE "ClSettings" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "enabledCurrencies" "Currency"[] DEFAULT ARRAY['IQD', 'USD']::"Currency"[],
    "defaultCurrency" "Currency" NOT NULL DEFAULT 'IQD',
    "sharePrivateNotes" BOOLEAN NOT NULL DEFAULT false,
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Baghdad',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClSettings_restaurantId_key" ON "ClSettings"("restaurantId");

-- AddForeignKey
ALTER TABLE "ClSettings" ADD CONSTRAINT "ClSettings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written CHECK: the default currency is one of the enabled ones, and at least one is enabled.
ALTER TABLE "ClSettings" ADD CONSTRAINT "ClSettings_currencies_check" CHECK (cardinality("enabledCurrencies") >= 1 AND "defaultCurrency" = ANY ("enabledCurrencies"));

-- The clinic product row: DISABLED until the owner creates plans and prices and enables it.
INSERT INTO "Application" ("id", "name", "status", "sortOrder", "createdAt", "updatedAt")
VALUES ('clinic', '{"en": "Clinics", "ar": "العيادات", "ckb": "کلینیکەکان"}', 'DISABLED', 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
