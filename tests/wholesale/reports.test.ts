import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { D } from '@/server/domain/wholesale/money';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { createCustomer, createItem, seedCities, setItemPrices } from '@/server/wholesale/catalog';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import { cashPosition, debts, lowStock, profit, salesByDay, stockValue } from '@/server/wholesale/posting/reports';
import { postSaleTx } from '@/server/wholesale/posting/sale';
import { convertCashTx } from '@/server/wholesale/posting/conversion';
import { setRate } from '@/server/wholesale/rates';
import { receiveStock } from '@/server/wholesale/stock';
import { seedWarehouses, warehouseOfKind } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The reports read the journal: cash boxes, debts, profit, stock value. */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
const run = <T>(restaurantId: string, fn: (tx: Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]) => Promise<T>) => db(restaurantId).$transaction(fn);

const today = baghdadDate();
const PARTNER = { id: 'u-partner', role: 'PARTNER' as const };
let A: string;
let B: string;
let shop: string;
let item: string;
let mainId: string;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  A = (await prisma().restaurant.create({ data: { name: 'Company A', sector: 'WHOLESALE' } })).id;
  B = (await prisma().restaurant.create({ data: { name: 'Company B', sector: 'WHOLESALE' } })).id;
  await prisma().user.create({ data: { id: PARTNER.id, name: 'p', email: 'p@example.com' } });
  await run(A, async (tx) => {
    await seedWarehouses(tx, A);
    await seedCities(tx, A);
    await seedChartOfAccounts(tx, A);
    await setRate(tx, A, today, 'USD', '1500');
    const city = await tx.whCity.findFirstOrThrow();
    item = (await createItem(tx, A, { code: 'RICE', names: { en: 'Rice', ar: 'رز', ckb: 'برنج' }, baseUnit: 'PIECE', units: [{ unit: 'PIECE', factorToBase: '1' }] })).id;
    await tx.whItem.update({ where: { id: item }, data: { reorderPoint: '95' } });
    await setItemPrices(tx, A, item, [{ unit: 'PIECE', priceIqd: '3000' }]);
    mainId = (await warehouseOfKind(tx, A, 'MAIN')).id;
    await receiveStock(tx, { restaurantId: A, itemId: item, warehouseId: mainId, qtyBase: new D(100), unitCostIqd: new D(2000), ref: { type: 'T', id: '1' }, user: PARTNER });
    shop = (await createCustomer(tx, A, { name: 'Shop', cityId: city.id })).id;
  });
});

const sell = (mode: 'CASH' | 'CREDIT', qty: string) =>
  run(A, (tx) => postSaleTx(tx, A, PARTNER, { customerId: shop, date: today, currency: 'IQD', paymentMode: mode, ...(mode === 'CREDIT' ? { dueDate: today } : {}), warehouseId: mainId, lines: [{ itemId: item, unit: 'PIECE', qty, mode: 'OFFICIAL' }] } as never));

describe('reports', () => {
  it('cash, debts, profit and stock value agree with the journal', async () => {
    await sell('CASH', '10'); // 30,000 in, cost 20,000
    await sell('CREDIT', '5'); // 15,000 owed, cost 10,000
    const pos = await run(A, (tx) => cashPosition(tx));
    expect(pos.cash.IQD?.toString()).toBe('30000');
    const d = await run(A, (tx) => debts(tx));
    expect(d.receivable.IQD?.toString()).toBe('15000');
    const p = await run(A, (tx) => profit(tx, { from: today, to: today }));
    expect(p.salesIqd.toString()).toBe('45000');
    expect(p.cogsIqd.toString()).toBe('30000');
    expect(p.netIqd.toString()).toBe('15000');
    const s = await run(A, (tx) => stockValue(tx));
    expect(s.totalIqd.toString()).toBe('170000'); // 85 pieces at 2,000
    expect(lowStock(s.rows).map((x) => x.code)).toEqual(['RICE']); // 85 is under the reorder point 95
    const days = await run(A, (tx) => salesByDay(tx, { from: today, to: today }));
    expect(days).toHaveLength(1);
    expect(days[0].count).toBe(2);
    expect(days[0].iqd.toString()).toBe('45000');
  });

  it('keeps one company out of another', async () => {
    await sell('CASH', '1');
    const other = await run(B, (tx) => cashPosition(tx));
    expect(Object.keys(other.cash)).toHaveLength(0);
    const s = await run(B, (tx) => stockValue(tx));
    expect(s.rows).toHaveLength(0);
  });

  it('shows each currency apart after a conversion', async () => {
    await run(A, (tx) => tx.whJournalEntry.count());
    await sell('CASH', '10');
    await run(A, async (tx) => {
      // 30,000 IQD cash bought dollars: 20 USD at 1500
      await convertCashTx(tx, A, PARTNER, { from: { amount: '30000', currency: 'IQD' }, toCurrency: 'USD', date: today });
    });
    const pos = await run(A, (tx) => cashPosition(tx));
    expect(pos.cash.IQD?.toString()).toBe('0');
    expect(pos.cash.USD?.toString()).toBe('20');
  });
});
