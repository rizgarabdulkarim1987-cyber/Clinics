import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { createItem } from '@/server/wholesale/catalog';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import { DemoNotEmptyError, fillDemoData, removeDemoData } from '@/server/wholesale/demoFill';
import { seedWarehouses } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Sample data fills an empty company once and refuses a company that has anything. */
const prisma = () => getPrisma();
let A: string;
const run = <T>(fn: (tx: Parameters<Parameters<ReturnType<typeof scopedClient>['$transaction']>[0]>[0]) => Promise<T>) => scopedClient(prisma(), { restaurantId: A }).$transaction(fn);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});
beforeEach(async () => {
  await resetTestData(prisma());
  A = (await prisma().restaurant.create({ data: { name: 'Company A', sector: 'WHOLESALE' } })).id;
  await prisma().user.create({ data: { id: 'u1', name: 'p', email: 'p@example.com' } });
  await run(async (tx) => {
    await seedWarehouses(tx, A);
    await seedChartOfAccounts(tx, A);
  });
});

describe('fillDemoData', () => {
  it('adds only what is missing and leaves what exists alone', async () => {
    await run((tx) => createItem(tx, A, { code: 'SUGAR-1', names: { en: 'My sugar', ar: 'سكري', ckb: 'شەکر' }, baseUnit: 'PIECE', units: [{ unit: 'PIECE', factorToBase: '1' }] }));
    const part = await run((tx) => fillDemoData(tx, A, { id: 'u1' }));
    expect(part).toEqual({ suppliers: 20, items: 9, customers: 20 });
    expect(await run((tx) => tx.whItem.findFirstOrThrow({ where: { code: 'SUGAR-1' } }))).toMatchObject({ names: { en: 'My sugar' } });
    await expect(run((tx) => fillDemoData(tx, A, { id: 'u1' }))).rejects.toBeInstanceOf(DemoNotEmptyError);
  });

  it('adds 20 suppliers and 10 items once, then refuses', async () => {
    const r = await run((tx) => fillDemoData(tx, A, { id: 'u1' }));
    expect(r).toEqual({ suppliers: 20, items: 10, customers: 20 });
    expect(await run((tx) => tx.whItem.count())).toBe(10);
    await expect(run((tx) => fillDemoData(tx, A, { id: 'u1' }))).rejects.toBeInstanceOf(DemoNotEmptyError);
  });

  it('removes the sample data: stock written off, items archived, customers and suppliers deleted', async () => {
    await run((tx) => fillDemoData(tx, A, { id: 'u1' }));
    const r = await run((tx) => removeDemoData(tx, A, { id: 'u1' }));
    expect(r).toEqual({ items: 10, customers: 20, suppliers: 20, kept: 0 });
    expect(await run((tx) => tx.whCustomer.count())).toBe(0);
    expect(await run((tx) => tx.whSupplier.count())).toBe(0);
    expect(await run((tx) => tx.whItem.count({ where: { active: true } }))).toBe(0);
    const left = await run((tx) => tx.whStockBalance.findMany({ select: { qtyBase: true } }));
    expect(left.every((b) => Number(b.qtyBase) === 0)).toBe(true);
  });
});
