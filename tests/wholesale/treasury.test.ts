import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { D } from '@/server/domain/wholesale/money';
import { ForbiddenError } from '@/server/domain/wholesale/permissions';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { createCustomer, createItem, seedCities, setItemPrices } from '@/server/wholesale/catalog';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import { convertCashTx } from '@/server/wholesale/posting/conversion';
import { confirmHandoverTx, getCustody, rejectHandoverTx, submitHandoverTx } from '@/server/wholesale/posting/custody';
import { approveExpenseTx, listExpenses, postExpenseTx, rejectExpenseTx } from '@/server/wholesale/posting/expense';
import { postSaleTx } from '@/server/wholesale/posting/sale';
import { setRate } from '@/server/wholesale/rates';
import { receiveStock } from '@/server/wholesale/stock';
import { createRepWarehouse, seedWarehouses, transferMainToRep, warehouseOfKind } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The treasury on a real database: conversion, a rep's custody and handover, expenses with approval. */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
const run = <T>(restaurantId: string, fn: (tx: Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]) => Promise<T>) => db(restaurantId).$transaction(fn);

const today = baghdadDate();
const PARTNER = { id: 'u-partner', role: 'PARTNER' as const };
const REP = { id: 'u-rep', role: 'REP' as const };
let A: string;
let repShop: string;
let repWh: string;
let item: string;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  A = (await prisma().restaurant.create({ data: { name: 'Company A', sector: 'WHOLESALE' } })).id;
  for (const [id, email] of [[PARTNER.id, 'p@example.com'], [REP.id, 'r@example.com']]) await prisma().user.create({ data: { id, name: id, email } });
  await run(A, async (tx) => {
    await seedWarehouses(tx, A);
    await seedCities(tx, A);
    await seedChartOfAccounts(tx, A);
    await setRate(tx, A, today, 'USD', '1500');
    await setRate(tx, A, today, 'IRT', '0.04');
    const city = await tx.whCity.findFirstOrThrow();
    item = (await createItem(tx, A, { code: 'RICE', names: { en: 'Rice', ar: 'رز', ckb: 'برنج' }, baseUnit: 'PIECE', units: [{ unit: 'PIECE', factorToBase: '1' }] })).id;
    await setItemPrices(tx, A, item, [{ unit: 'PIECE', priceIqd: '3000' }]);
    const mainId = (await warehouseOfKind(tx, A, 'MAIN')).id;
    await receiveStock(tx, { restaurantId: A, itemId: item, warehouseId: mainId, qtyBase: new D(100), unitCostIqd: new D(2000), ref: { type: 'T', id: '1' }, user: PARTNER });
    await tx.whStaff.create({ data: { restaurantId: A, userId: REP.id, role: 'REP' } });
    repWh = (await createRepWarehouse(tx, A, REP.id)).id;
    await transferMainToRep(tx, A, PARTNER.id, { itemId: item, toWarehouseId: repWh, qtyBase: '50' });
    repShop = (await createCustomer(tx, A, { name: 'Rep shop', cityId: city.id, repId: REP.id })).id;
    // the rep sells 10 pieces for cash: 30,000 IQD enters his custody
    await postSaleTx(tx, A, REP, { customerId: repShop, date: today, currency: 'IQD', paymentMode: 'CASH', warehouseId: repWh, lines: [{ itemId: item, unit: 'PIECE', qty: '10', mode: 'OFFICIAL' }] } as never);
  });
});

async function assertBalanced() {
  const rows = await run(A, (tx) => tx.whJournalLine.findMany({ select: { entryId: true, side: true, baseIqd: true } }));
  const by = new Map<string, InstanceType<typeof D>>();
  for (const r of rows) {
    const v = new D(r.baseIqd.toString());
    by.set(r.entryId, (by.get(r.entryId) ?? new D(0)).plus(r.side === 'DR' ? v : v.neg()));
  }
  for (const v of by.values()) expect(v.abs().toNumber()).toBeLessThan(0.0001);
}

describe('treasury', () => {
  it('converts dollars to dinars at the day rates', async () => {
    const r = await run(A, (tx) => convertCashTx(tx, A, PARTNER, { from: { amount: '100', currency: 'USD' }, toCurrency: 'IQD', date: today }));
    expect(r.toAmount.toString()).toBe('150000');
    await assertBalanced();
    await expect(run(A, (tx) => convertCashTx(tx, A, PARTNER, { from: { amount: '1', currency: 'USD' }, toCurrency: 'USD', date: today }))).rejects.toThrow();
  });

  it('a rep hands over his custody; a partner confirms what arrived and the shortage stays with the rep', async () => {
    const before = await run(A, (tx) => getCustody(tx, A, REP, REP.id));
    expect(before.find((c) => c.currency === 'IQD')?.available.toString()).toBe('30000');
    const { handoverId } = await run(A, (tx) => submitHandoverTx(tx, A, REP, { amounts: [{ amount: '30000', currency: 'IQD' }] }));
    await expect(run(A, (tx) => submitHandoverTx(tx, A, REP, { amounts: [{ amount: '1', currency: 'IQD' }] }))).rejects.toThrow();
    await expect(run(A, (tx) => confirmHandoverTx(tx, A, REP, handoverId, [{ amount: '30000', currency: 'IQD' }]))).rejects.toBeInstanceOf(ForbiddenError);
    const done = await run(A, (tx) => confirmHandoverTx(tx, A, PARTNER, handoverId, [{ amount: '29000', currency: 'IQD' }]));
    expect(done.status).toBe('CONFIRMED_SHORT');
    const after = await run(A, (tx) => getCustody(tx, A, REP, REP.id));
    expect(after.find((c) => c.currency === 'IQD')?.balance.toString()).toBe('1000');
    await assertBalanced();
  });

  it('a rejected handover frees the reserved cash', async () => {
    const { handoverId } = await run(A, (tx) => submitHandoverTx(tx, A, REP, { amounts: [{ amount: '30000', currency: 'IQD' }] }));
    await run(A, (tx) => rejectHandoverTx(tx, A, PARTNER, handoverId, 'wrong count'));
    const c = await run(A, (tx) => getCustody(tx, A, REP, REP.id));
    expect(c.find((x) => x.currency === 'IQD')?.available.toString()).toBe('30000');
  });

  it('a partner posts an expense at once; a rep expense waits and is paid from his custody', async () => {
    const direct = await run(A, (tx) => postExpenseTx(tx, A, PARTNER, { category: 'RENT', amount: { amount: '500000', currency: 'IQD' }, date: today }));
    expect(direct.status).toBe('POSTED');
    const held = await run(A, (tx) => postExpenseTx(tx, A, REP, { category: 'FUEL', amount: { amount: '5000', currency: 'IQD' }, date: '2000-01-01' }));
    expect(held.status).toBe('PENDING');
    await expect(run(A, (tx) => approveExpenseTx(tx, A, REP, held.expenseId))).rejects.toBeInstanceOf(ForbiddenError);
    await run(A, (tx) => approveExpenseTx(tx, A, PARTNER, held.expenseId));
    const c = await run(A, (tx) => getCustody(tx, A, REP, REP.id));
    expect(c.find((x) => x.currency === 'IQD')?.balance.toString()).toBe('25000');
    const rejected = await run(A, (tx) => postExpenseTx(tx, A, REP, { category: 'FUEL', amount: { amount: '100', currency: 'IQD' }, date: today }));
    await run(A, (tx) => rejectExpenseTx(tx, A, PARTNER, rejected.expenseId, 'no receipt'));
    const mine = await run(A, (tx) => listExpenses(tx, REP));
    expect(mine.map((e) => e.status).sort()).toEqual(['POSTED', 'REJECTED']);
    await assertBalanced();
  });
});
