-- CreateTable
CREATE TABLE "WhRepTarget" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amountIqd" DECIMAL(24,4),
    "weightKg" DECIMAL(24,4),
    "pieces" DECIMAL(24,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhRepTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhRepItemTarget" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyBase" DECIMAL(24,8) NOT NULL,

    CONSTRAINT "WhRepItemTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhRepTarget_restaurantId_userId_month_key" ON "WhRepTarget"("restaurantId", "userId", "month");

-- CreateIndex
CREATE INDEX "WhRepTarget_restaurantId_month_idx" ON "WhRepTarget"("restaurantId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "WhRepItemTarget_targetId_itemId_key" ON "WhRepItemTarget"("targetId", "itemId");

-- CreateIndex
CREATE INDEX "WhRepItemTarget_restaurantId_idx" ON "WhRepItemTarget"("restaurantId");

-- AddForeignKey
ALTER TABLE "WhRepTarget" ADD CONSTRAINT "WhRepTarget_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhRepItemTarget" ADD CONSTRAINT "WhRepItemTarget_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "WhRepTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhRepItemTarget" ADD CONSTRAINT "WhRepItemTarget_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WhItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhRepItemTarget" ADD CONSTRAINT "WhRepItemTarget_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
