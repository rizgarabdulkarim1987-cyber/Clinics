-- CreateEnum
CREATE TYPE "ClKind" AS ENUM ('CLINIC', 'BEAUTY');

-- AlterTable
ALTER TABLE "ClSettings" ADD COLUMN "kind" "ClKind" NOT NULL DEFAULT 'CLINIC';

-- AlterTable
ALTER TABLE "ClAccount" ADD COLUMN "space" "ClKind" NOT NULL DEFAULT 'CLINIC';

-- One address may hold a clinic account and a beauty account that never meet.
DROP INDEX "ClAccount_email_key";
CREATE UNIQUE INDEX "ClAccount_email_space_key" ON "ClAccount"("email", "space");
