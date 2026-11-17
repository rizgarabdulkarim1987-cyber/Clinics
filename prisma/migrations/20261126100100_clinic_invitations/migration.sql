-- CreateTable
CREATE TABLE "ClInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "role" "ClRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClInvitation_tokenHash_key" ON "ClInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "ClInvitation_email_idx" ON "ClInvitation"("email");

-- CreateIndex
CREATE INDEX "ClInvitation_restaurantId_idx" ON "ClInvitation"("restaurantId");

-- AddForeignKey
ALTER TABLE "ClInvitation" ADD CONSTRAINT "ClInvitation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
