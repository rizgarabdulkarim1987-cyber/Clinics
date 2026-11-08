/**
 * Development only: makes one wholesale company in the local database, owned by the seeded owner (owner@buzzify.test), with
 * a partner and a rep, a few items, a rep warehouse and some stock, so the Wholesale screens can be looked at.
 * Refuses any database that is not on 127.0.0.1. Run: DATABASE_URL=postgresql://...127.0.0.1:<port>/buzzify npx tsx scripts/dev-wholesale.ts
 */
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { D } from '@/server/domain/wholesale/money';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { createItem, createSupplier, seedCities, setItemPrices } from '@/server/wholesale/catalog';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import { addLandedCostTx, postPurchaseTx } from '@/server/wholesale/posting/purchase';
import { setRate } from '@/server/wholesale/rates';
import { receiveStock } from '@/server/wholesale/stock';
import { createRepWarehouse, seedWarehouses, transferMainToRep, warehouseOfKind } from '@/server/wholesale/warehouses';

const url = process.env.DATABASE_URL ?? '';
if (!/@127\.0\.0\.1:\d+\//.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at 127.0.0.1');

const prisma = getPrisma();
const OWNER = 'owner@buzzify.test';

/** Rates for today, a foreign supplier and one dollar purchase with shipping, so the purchase screens have something to show. */
async function seedPurchases(rid: string, ownerId: string) {
  await scopedClient(prisma, { restaurantId: rid }).$transaction(async (tx) => {
    await seedChartOfAccounts(tx, rid);
    const today = baghdadDate();
    await setRate(tx, rid, today, 'USD', '1500');
    await setRate(tx, rid, today, 'IRT', '0.04');
    if ((await tx.whPurchase.count()) > 0) return;
    const supplier = await createSupplier(tx, rid, { name: 'Gulf Foods (Dubai)', country: 'AE', isForeign: true });
    const item = await tx.whItem.findFirstOrThrow({ where: { code: 'RICE-5' } });
    const made = await postPurchaseTx(tx, rid, { id: ownerId }, { supplierId: supplier.id, date: today, currency: 'USD', paymentMode: 'CREDIT', lines: [{ itemId: item.id, unit: 'CARTON', qty: '20', unitPrice: '30' }] });
    await addLandedCostTx(tx, rid, { id: ownerId }, made.purchaseId, { kind: 'SHIPPING', amount: '90', currency: 'USD', date: today });
  });
  console.log('Purchases ready');
}

async function main() {
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER } });
  await prisma.application.update({ where: { id: 'wholesale' }, data: { status: 'ACTIVE' } });
  const existing = await prisma.restaurant.findFirst({ where: { name: 'Nare Trading (Demo)' } });
  if (existing) {
    console.log('Already there:', existing.id);
    await seedPurchases(existing.id, owner.id);
    return;
  }
  const company = await prisma.restaurant.create({ data: { name: 'Nare Trading (Demo)', sector: 'WHOLESALE' } });
  const rid = company.id;
  await prisma.membership.create({ data: { userId: owner.id, restaurantId: rid, role: 'OWNER' } });
  const now = Date.now();
  await prisma.subscription.create({
    data: {
      restaurantId: rid,
      applicationId: 'wholesale',
      planCode: 'standard',
      status: 'ACTIVE',
      period: 'MONTHLY',
      currency: 'IQD',
      priceMinor: 0,
      currentPeriodStart: new Date(now - 86_400_000),
      currentPeriodEnd: new Date(now + 29 * 86_400_000),
      graceDays: 7,
      version: 1,
    },
  });
  const rep = await prisma.user.upsert({
    where: { email: 'rep@buzzify.test' },
    update: {},
    create: { id: 'dev-wh-rep', name: 'Rep Karwan', email: 'rep@buzzify.test' },
  });
  const partner = await prisma.user.upsert({
    where: { email: 'partner@buzzify.test' },
    update: {},
    create: { id: 'dev-wh-partner', name: 'Partner Dilan', email: 'partner@buzzify.test' },
  });
  await prisma.whStaff.create({ data: { restaurantId: rid, userId: partner.id, role: 'PARTNER' } });
  await prisma.whStaff.create({ data: { restaurantId: rid, userId: rep.id, role: 'REP' } });

  await scopedClient(prisma, { restaurantId: rid }).$transaction(async (tx) => {
    await seedWarehouses(tx, rid);
    await seedCities(tx, rid);
    const main = await warehouseOfKind(tx, rid, 'MAIN');
    const repWh = await createRepWarehouse(tx, rid, rep.id);
    const items = [
      { code: 'RICE-5', names: { ckb: 'برنجی ٥ کیلۆ', ar: 'رز 5 كغم', en: 'Rice 5 kg' }, category: 'Grains', cost: 4200, carton: 6, price: 6000 },
      { code: 'OIL-1', names: { ckb: 'ڕۆنی خواردن', ar: 'زيت طعام', en: 'Cooking oil 1 L' }, category: 'Oils', cost: 2500, carton: 12, price: 3500 },
      { code: 'TEA-400', names: { ckb: 'چای ٤٠٠ گرام', ar: 'شاي 400 غم', en: 'Tea 400 g' }, category: 'Tea', cost: 3100, carton: 24, price: 4200 },
    ];
    for (const it of items) {
      const made = await createItem(tx, rid, {
        code: it.code,
        names: it.names,
        category: it.category,
        baseUnit: 'PIECE',
        units: [
          { unit: 'PIECE', factorToBase: '1' },
          { unit: 'CARTON', factorToBase: String(it.carton) },
        ],
      });
      await setItemPrices(tx, rid, made.id, [
        { unit: 'PIECE', priceIqd: String(it.price) },
        { unit: 'CARTON', priceIqd: String(it.price * it.carton) },
      ]);
      await receiveStock(tx, { restaurantId: rid, itemId: made.id, warehouseId: main.id, qtyBase: new D(it.carton * 40), unitCostIqd: new D(it.cost), ref: { type: 'DEV', id: it.code }, user: { id: owner.id } });
      await transferMainToRep(tx, rid, owner.id, { itemId: made.id, toWarehouseId: repWh.id, qtyBase: String(it.carton * 5) });
    }
  });
  console.log('Made the demo wholesale company:', rid);
  await seedPurchases(rid, owner.id);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
