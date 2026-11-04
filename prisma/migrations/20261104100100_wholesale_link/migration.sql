-- CreateTable
CREATE TABLE "WholesaleLink" (
    "restaurantId" TEXT NOT NULL,
    "adminUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleLink_pkey" PRIMARY KEY ("restaurantId")
);

-- AddForeignKey
ALTER TABLE "WholesaleLink" ADD CONSTRAINT "WholesaleLink_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written CHECK: the company's own system is only ever reached over https.
ALTER TABLE "WholesaleLink" ADD CONSTRAINT "WholesaleLink_adminUrl_check" CHECK ("adminUrl" IS NULL OR "adminUrl" LIKE 'https://%');

-- The wholesale product row: DISABLED until the owner creates plans and prices and enables it.
INSERT INTO "Application" ("id", "name", "status", "sortOrder", "createdAt", "updatedAt")
VALUES ('wholesale', '{"en": "Wholesale", "ar": "الجملة", "ckb": "کۆفرۆشی"}', 'DISABLED', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
