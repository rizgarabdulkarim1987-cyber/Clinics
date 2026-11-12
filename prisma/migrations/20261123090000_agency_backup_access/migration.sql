-- CreateTable
CREATE TABLE "AccountBackup" (
    "id" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "entries" INTEGER NOT NULL,
    "book" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountBackup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountAccess" (
    "userId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountAccess_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountBackup_takenOn_key" ON "AccountBackup"("takenOn");
