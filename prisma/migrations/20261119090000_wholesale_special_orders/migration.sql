-- Special orders are a sale to the customer: delivery posts SALES and COGS, so the movement kind COMMISSION gives way to SALE,
-- every cost (goods, shipping, customs...) is labelled, and what is paid before delivery sits in a new asset account.
ALTER TYPE "WhAgencyMovementKind" ADD VALUE IF NOT EXISTS 'SALE';

ALTER TABLE "WhAgencyMovement" ADD COLUMN "category" TEXT;

INSERT INTO "WhLedgerAccount" ("id", "restaurantId", "code", "type", "normalSide", "name", "postable", "updatedAt")
SELECT gen_random_uuid()::text, r."restaurantId", 'AGENCY_WIP', 'ASSET'::"WhAccountType", 'DR'::"WhSide",
  '{"ckb":"کاڵای ڕێگا (داواکاری تایبەت)","ar":"طلبيات خاصة قيد التنفيذ","en":"Special orders in progress"}'::jsonb, true, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "restaurantId" FROM "WhLedgerAccount") r
ON CONFLICT ("restaurantId", "code") DO NOTHING;

UPDATE "WhLedgerAccount" SET "name" = '{"ckb":"قەرزی داواکارییە تایبەتەکان","ar":"ذمم الطلبيات الخاصة","en":"Special orders receivable"}'::jsonb WHERE "code" = 'AGENCY_RECEIVABLE';
