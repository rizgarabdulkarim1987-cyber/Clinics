import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { ForbiddenError } from '@/server/domain/wholesale/permissions';
import { createCustomer, createItem, seedCities } from '@/server/wholesale/catalog';
import { importOpeningTx, listOpeningImports, OpeningImportError } from '@/server/wholesale/import/opening';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import { cashPosition, debts, stockValue } from '@/server/wholesale/posting/reports';
import { seedWarehouses } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Opening balances: the starting position of a company that already trades. */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
type Tx = Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0];
const run = <T>(rid: string, fn: (tx: Tx) => Promise<T>) => db(rid).$transaction(fn);

const PARTNER = { id: 'u-partner', role: 'PARTNER' as const };
const REP = { id: 'u-rep', role: 'REP' as const };
let A: string;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  A = (await prisma().restaurant.create({ data: { name: 'Company A', sector: 'WHOLESALE' } })).id;
  await run(A, async (tx) => {
    await seedWarehouses(tx, A);
    await seedCities(tx, A);
    await seedChartOfAccounts(tx, A);
    const city = await tx.whCity.findFirstOrThrow();
    await createItem(tx, A, { code: 'RICE', names: { en: 'Rice' }, baseUnit: 'PIECE', units: [{ unit: 'PIECE', factorToBase: '1' }] });
    await createCustomer(tx, A, { name: 'Shop', cityId: city.id });
    await tx.whSupplier.create({ data: { restaurantId: A, name: 'Mill', isForeign: false } as never });
  });
});

const imp = (kind: 'STOCK' | 'CUSTOMERS' | 'SUPPLIERS' | 'CASH', csv: string, user = PARTNER) => run(A, (tx) => importOpeningTx(tx, A, user, csv, kind));

describe('opening balances', () => {
  it('cash opens each currency once, at the pinned rate', async () => {
    const r = await imp('CASH', 'currency,amount,rate\nIQD,5000000,\nUSD,1000,1500');
    expect(r.errors).toEqual([]);
    expect(r.imported).toBe(2);
    const cash = await run(A, (tx) => cashPosition(tx));
    expect(cash.cash.IQD?.toString()).toBe('5000000');
    expect(cash.cash.USD?.toString()).toBe('1000');
    const again = await imp('CASH', 'currency,amount\nIQD,1');
    expect(again.imported).toBe(0);
    expect(again.errors[0]!.message).toMatch(/already has an opening balance/);
  });

  it('customer and supplier debts are opening documents', async () => {
    expect((await imp('CUSTOMERS', 'customer,currency,amount\nShop,IQD,250000')).errors).toEqual([]);
    expect((await imp('SUPPLIERS', 'supplier,currency,amount\nMill,IQD,100000')).errors).toEqual([]);
    const d = await run(A, (tx) => debts(tx));
    expect(d.receivable.IQD?.toString()).toBe('250000');
    expect(d.payable.IQD?.toString()).toBe('100000');
  });

  it('stock goes through the stock engine and is valued at cost, once only', async () => {
    const r = await imp('STOCK', 'item,qty,unit_cost,currency\nRICE,100,2000,IQD');
    expect(r.errors).toEqual([]);
    expect((await run(A, (tx) => stockValue(tx))).totalIqd.toString()).toBe('200000');
    await expect(imp('STOCK', 'item,qty,unit_cost,currency\nRICE,1,1,IQD')).rejects.toThrow(OpeningImportError);
  });

  it('reports every problem by row and writes nothing', async () => {
    const r = await imp('CUSTOMERS', 'customer,currency,amount\nNobody,IQD,100\nShop,EUR,100\nShop,IQD,-5\nShop,USD,10');
    expect(r.imported).toBe(0);
    expect(r.errors.map((e) => e.row)).toEqual([1, 2, 3, 4]);
    expect((await run(A, (tx) => listOpeningImports(tx))).length).toBe(0);
  });

  it('a rep may not import', async () => {
    await expect(imp('CASH', 'currency,amount\nIQD,1', REP as never)).rejects.toThrow(ForbiddenError);
  });
});
