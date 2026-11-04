-- AlterEnum
-- A new enum value cannot be used in the transaction that adds it: the table and the product row are in the next migration.
ALTER TYPE "BusinessSector" ADD VALUE 'WHOLESALE';
