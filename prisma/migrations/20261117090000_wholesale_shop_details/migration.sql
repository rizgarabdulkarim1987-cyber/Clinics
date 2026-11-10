-- A shop has an owner and an address; the rest of Iraq's provinces join the city list of every company that has one.
ALTER TABLE "WhCustomer" ADD COLUMN "ownerName" TEXT;
ALTER TABLE "WhCustomer" ADD COLUMN "address" TEXT;

INSERT INTO "WhCity" ("id", "restaurantId", "code", "name")
SELECT gen_random_uuid()::text, r."restaurantId", c."code", c."name"::jsonb
FROM (SELECT DISTINCT "restaurantId" FROM "WhCity") r
CROSS JOIN (VALUES
  ('anbar', '{"ckb":"ئەنبار","ar":"الأنبار","en":"Anbar"}'),
  ('babil', '{"ckb":"بابل","ar":"بابل","en":"Babil"}'),
  ('diyala', '{"ckb":"دیالە","ar":"ديالى","en":"Diyala"}'),
  ('dhiqar', '{"ckb":"زیقار","ar":"ذي قار","en":"Dhi Qar"}'),
  ('maysan', '{"ckb":"میسان","ar":"ميسان","en":"Maysan"}'),
  ('muthanna', '{"ckb":"موسەننا","ar":"المثنى","en":"Muthanna"}'),
  ('qadisiyyah', '{"ckb":"قادسیە","ar":"القادسية","en":"Qadisiyyah"}'),
  ('salahuddin', '{"ckb":"سەلاحەدین","ar":"صلاح الدين","en":"Salah al-Din"}'),
  ('wasit', '{"ckb":"واست","ar":"واسط","en":"Wasit"}')
) AS c("code", "name")
ON CONFLICT ("restaurantId", "code") DO NOTHING;
