import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { D } from '@/server/domain/wholesale/money';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { createCustomer, createItem, seedCities, setItemPrices } from '@/server/wholesale/catalog';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import { copyCompany } from '@/server/wholesale/migration/copy-company';
import { cashPosition, debts, stockValue } from '@/server/wholesale/posting/reports';
import { postSaleTx } from '@/server/wholesale/posting/sale';
import { setRate } from '@/server/wholesale/rates';
import { receiveStock } from '@/server/wholesale/stock';
import { seedWarehouses, warehouseOfKind } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Copying a company out of the standalone system: faithful, all-or-nothing, and a dry run leaves nothing behind. */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
const today = baghdadDate();
const PARTNER = { id: 'u-partner', role: 'PARTNER' as const };
const TABLES = ['ExchangeRate', 'LedgerAccount', 'JournalEntry', 'JournalLine', 'PeriodEvent', 'Item', 'ItemUnit', 'PriceListEntry', 'City', 'Customer', 'Supplier', 'Warehouse', 'StockBalance', 'StockMovement', 'Batch', 'Purchase', 'PurchaseLine', 'LandedCost', 'LandedCostAllocation', 'SupplierPayment', 'Setting', 'Sale', 'SaleLine', 'SaleLineBatch', 'CustomerPayment', 'SaleReturn', 'SaleReturnLine', 'SaleReturnLineBatch', 'SaleReturnOffset', 'CurrencyConversion', 'CustodyHandover', 'CustodyHandoverLine', 'Expense', 'OpeningImport', 'OpeningDebt', 'StockCount', 'StockCountLine', 'PurchaseReturn', 'PurchaseReturnLine'];

let A: string;
let B: string;
let expected: { counts: { entries: number; lines: number; sales: number; moves: number }; books: { cash?: string; owed?: string; stock: string } };
let client: Client;

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  client = new Client({ connectionString: databaseUrl(TEST_DB) });
  await client.connect();
});

afterAll(async () => {
  await client.query('DROP SCHEMA IF EXISTS legacy CASCADE');
  await client.end();
});

beforeEach(async () => {
  await resetTestData(prisma());
  await client.query('DROP SCHEMA IF EXISTS legacy CASCADE');
  A = (await prisma().restaurant.create({ data: { name: 'Old company', sector: 'WHOLESALE' } })).id;
  const run = <T>(rid: string, fn: (tx: Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]) => Promise<T>) => db(rid).$transaction(fn);
  await run(A, async (tx) => {
    await seedWarehouses(tx, A);
    await seedCities(tx, A);
    await seedChartOfAccounts(tx, A);
    await setRate(tx, A, today, 'USD', '1500');
    const city = await tx.whCity.findFirstOrThrow();
    const item = (await createItem(tx, A, { code: 'RICE', names: { en: 'Rice', ar: 'رز', ckb: 'برنج' }, baseUnit: 'PIECE', units: [{ unit: 'PIECE', factorToBase: '1' }] })).id;
    await setItemPrices(tx, A, item, [{ unit: 'PIECE', priceIqd: '3000' }]);
    const mainId = (await warehouseOfKind(tx, A, 'MAIN')).id;
    await receiveStock(tx, { restaurantId: A, itemId: item, warehouseId: mainId, qtyBase: new D(100), unitCostIqd: new D(2000), ref: { type: 'T', id: '1' }, user: PARTNER });
    const shop = (await createCustomer(tx, A, { name: 'Shop', cityId: city.id })).id;
    const sale = (mode: 'CASH' | 'CREDIT', qty: string) => postSaleTx(tx, A, PARTNER, { customerId: shop, date: today, currency: 'IQD', paymentMode: mode, ...(mode === 'CREDIT' ? { dueDate: today } : {}), warehouseId: mainId, lines: [{ itemId: item, unit: 'PIECE', qty, mode: 'OFFICIAL' }] } as never);
    await sale('CASH', '10');
    await sale('CREDIT', '5');
  });
  // The "standalone system": the same tables without the prefix and without the company column, in their own schema.
  await client.query('CREATE SCHEMA legacy');
  for (const t of TABLES) {
    await client.query(`CREATE TABLE legacy."${t}" AS SELECT * FROM "Wh${t}" WHERE "restaurantId" = $1`, [A]);
    await client.query(`ALTER TABLE legacy."${t}" DROP COLUMN "restaurantId"`);
  }
  await client.query(`CREATE TABLE legacy."User" (id text, name text, email text, role text, "warehouseId" text, active boolean)`);
  await client.query(`INSERT INTO legacy."User" VALUES ('old-p', 'p', 'Partner@Example.com', 'PARTNER', null, true)`);
  expected = {
    counts: await counts(A),
    books: await db(A).$transaction(async (tx) => ({ cash: (await cashPosition(tx)).cash.IQD?.toString(), owed: (await debts(tx)).receivable.IQD?.toString(), stock: (await stockValue(tx)).totalIqd.toString() })),
  };
  // The old system is another database: its company is not in this one.
  await resetTestData(prisma());
  B = (await prisma().restaurant.create({ data: { name: 'New company', sector: 'WHOLESALE' } })).id;
  await prisma().user.create({ data: { id: PARTNER.id, name: 'p', email: 'partner@example.com' } });
  // The new company was only set up: it holds the starting chart and warehouses the copy must replace.
  await run(B, async (tx) => {
    await seedWarehouses(tx, B);
    await seedCities(tx, B);
    await seedChartOfAccounts(tx, B);
  });
});

const counts = (rid: string) => db(rid).$transaction(async (tx) => ({ entries: await tx.whJournalEntry.count(), lines: await tx.whJournalLine.count(), sales: await tx.whSale.count(), moves: await tx.whStockMovement.count() }));

describe('copying a company', () => {
  it('a dry run checks everything and leaves nothing behind', async () => {
    const report = await copyCompany(client, client, { restaurantId: B, sourceSchema: 'legacy' });
    expect(report.ok).toBe(true);
    expect(report.applied).toBe(false);
    expect(report.tables.find((t) => t.table === 'Sale')).toMatchObject({ source: 2, copied: 2 });
    expect((await counts(B)).entries).toBe(0);
    expect(await db(B).$transaction((tx) => tx.whItem.count())).toBe(0);
  });

  it('apply brings the books across: same cash, debts and stock, balanced, new numbers, staff linked to the account', async () => {
    const report = await copyCompany(client, client, { restaurantId: B, sourceSchema: 'legacy', apply: true });
    expect(report.applied).toBe(true);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(await counts(B)).toEqual(expected.counts);
    const read = (rid: string) => db(rid).$transaction(async (tx) => ({ cash: (await cashPosition(tx)).cash.IQD?.toString(), owed: (await debts(tx)).receivable.IQD?.toString(), stock: (await stockValue(tx)).totalIqd.toString() }));
    expect(await read(B)).toEqual(expected.books);
    expect(expected.books).toEqual({ cash: '30000', owed: '15000', stock: '170000' });
    const staff = await db(B).$transaction((tx) => tx.whStaff.findMany({ select: { userId: true, role: true } }));
    expect(staff).toEqual([{ userId: PARTNER.id, role: 'PARTNER' }]);
    const numbers = await db(B).$transaction((tx) => tx.whSale.findMany({ select: { number: true } }));
    expect(numbers.every((n) => n.number > 0n)).toBe(true);
  });

  it('refuses a company that already has data, and a person with no account here', async () => {
    await copyCompany(client, client, { restaurantId: B, sourceSchema: 'legacy', apply: true });
    await expect(copyCompany(client, client, { restaurantId: B, sourceSchema: 'legacy', apply: true })).rejects.toThrow(/empty company/);
    const C = (await prisma().restaurant.create({ data: { name: 'Third', sector: 'WHOLESALE' } })).id;
    await client.query(`INSERT INTO legacy."User" VALUES ('old-x', 'x', 'nobody@example.com', 'REP', null, true)`);
    await expect(copyCompany(client, client, { restaurantId: C, sourceSchema: 'legacy', apply: true })).rejects.toThrow(/no account here/);
    expect((await counts(C)).entries).toBe(0);
  });
});
