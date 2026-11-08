import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { InsufficientStockError } from '@/server/domain/wholesale/costing';
import { D } from '@/server/domain/wholesale/money';
import { createItem, createCustomer, listCustomers, seedCities, setItemPrices, updateItem, ItemLockedError, InvalidCatalogError } from '@/server/wholesale/catalog';
import { issueStock, onHand, receiveStock, recostOnHand, reverseReceipt, transferStock } from '@/server/wholesale/stock';
import { createRepWarehouse, seedWarehouses, stockFor, transferMainToRep, warehouseOfKind } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/**
 * The stock engine and the catalog of a wholesale company, on a real database: carton, piece and ton units, weighted-average
 * cost, a rep's own warehouse, and the wall between two companies.
 */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
const run = <T>(restaurantId: string, fn: (tx: Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]) => Promise<T>) => db(restaurantId).$transaction(fn);

let A: string;
let B: string;
const USER = 'u-partner';
const REF = { type: 'TEST', id: 't1' };

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  A = (await prisma().restaurant.create({ data: { name: 'Company A', sector: 'WHOLESALE' } })).id;
  B = (await prisma().restaurant.create({ data: { name: 'Company B', sector: 'WHOLESALE' } })).id;
  await prisma().user.create({ data: { id: USER, name: 'Partner', email: 'partner@example.com' } });
  for (const id of [A, B]) await run(id, (tx) => seedWarehouses(tx, id));
});

const rice = {
  code: 'RICE',
  names: { en: 'Rice', ar: 'رز', ckb: 'برنج' },
  baseUnit: 'PIECE' as const,
  units: [
    { unit: 'PIECE' as const, factorToBase: '1' },
    { unit: 'CARTON' as const, factorToBase: '12' },
    { unit: 'TON' as const, factorToBase: '1000' },
  ],
};

describe('the catalog', () => {
  it('stores an item in carton, piece and ton, and keeps one company from reading another', async () => {
    const item = await run(A, (tx) => createItem(tx, A, rice));
    const mine = await run(A, async (tx) => (await tx.whItem.findMany()).map((i) => i.code));
    const theirs = await run(B, async (tx) => (await tx.whItem.findMany()).map((i) => i.code));
    expect(mine).toEqual(['RICE']);
    expect(theirs).toEqual([]);
    // The same code is free in another company.
    await run(B, (tx) => createItem(tx, B, rice));
    await expect(run(A, (tx) => createItem(tx, A, rice))).rejects.toBeInstanceOf(InvalidCatalogError);
    const units = await run(A, (tx) => tx.whItemUnit.findMany({ where: { itemId: item.id }, orderBy: { unit: 'asc' } }));
    expect(units.map((u) => [u.unit, u.factorToBase.toFixed()])).toEqual([
      ['PIECE', '1'],
      ['CARTON', '12'],
      ['TON', '1000'],
    ]);
  });

  it('prices each unit and refuses a unit the item does not have', async () => {
    const item = await run(A, (tx) => createItem(tx, A, { ...rice, units: [{ unit: 'PIECE', factorToBase: '1' }] }));
    await run(A, (tx) => setItemPrices(tx, A, item.id, [{ unit: 'PIECE', priceIqd: '1500' }]));
    await expect(run(A, (tx) => setItemPrices(tx, A, item.id, [{ unit: 'TON', priceIqd: '1' }]))).rejects.toBeInstanceOf(InvalidCatalogError);
  });

  it('freezes the units of an item that has stock, but lets other fields change', async () => {
    const item = await run(A, (tx) => createItem(tx, A, rice));
    const main = await run(A, (tx) => warehouseOfKind(tx, A, 'MAIN'));
    await run(A, (tx) => receiveStock(tx, { restaurantId: A, itemId: item.id, warehouseId: main.id, qtyBase: new D(10), unitCostIqd: new D(100), ref: REF, user: { id: USER } }));
    await expect(run(A, (tx) => updateItem(tx, A, item.id, { ...rice, units: [{ unit: 'PIECE', factorToBase: '1' }, { unit: 'CARTON', factorToBase: '24' }, { unit: 'TON', factorToBase: '1000' }] }))).rejects.toBeInstanceOf(ItemLockedError);
    await run(A, (tx) => updateItem(tx, A, item.id, { ...rice, category: 'Grains' }));
    expect((await run(A, (tx) => tx.whItem.findUniqueOrThrow({ where: { id: item.id } }))).category).toBe('Grains');
  });

  it('gives a rep only his own customers', async () => {
    await run(A, (tx) => seedCities(tx, A));
    const city = await run(A, (tx) => tx.whCity.findFirstOrThrow());
    await prisma().user.create({ data: { id: 'u-rep', name: 'Rep', email: 'rep@example.com' } });
    await prisma().whStaff.create({ data: { restaurantId: A, userId: 'u-rep', role: 'REP' } });
    await run(A, (tx) => createCustomer(tx, A, { name: 'Mine', cityId: city.id, repId: 'u-rep' }));
    await run(A, (tx) => createCustomer(tx, A, { name: 'Nobody', cityId: city.id }));
    const asRep = await run(A, (tx) => listCustomers(tx, A, { role: 'REP', userId: 'u-rep' }));
    const asPartner = await run(A, (tx) => listCustomers(tx, A, { role: 'PARTNER', userId: USER }));
    expect(asRep.map((c) => c.name)).toEqual(['Mine']);
    expect(asPartner.map((c) => c.name)).toEqual(['Mine', 'Nobody']);
    await expect(run(A, (tx) => createCustomer(tx, A, { name: 'X', cityId: city.id, repId: USER }))).rejects.toBeInstanceOf(InvalidCatalogError);
  });
});

describe('the stock engine', () => {
  it('re-averages the cost on each receipt and issues at the average', async () => {
    const item = await run(A, (tx) => createItem(tx, A, rice));
    const main = await run(A, (tx) => warehouseOfKind(tx, A, 'MAIN'));
    const base = { restaurantId: A, itemId: item.id, warehouseId: main.id, ref: REF, user: { id: USER } };
    await run(A, (tx) => receiveStock(tx, { ...base, qtyBase: new D(10), unitCostIqd: new D(100) }));
    await run(A, (tx) => receiveStock(tx, { ...base, qtyBase: new D(10), unitCostIqd: new D(200) }));
    const out = await run(A, (tx) => issueStock(tx, { ...base, qtyBase: new D(5) }));
    expect(out.unitCostIqd.toFixed()).toBe('150');
    expect((await run(A, (tx) => onHand(tx, A, item.id, main.id))).toFixed()).toBe('15');
    await expect(run(A, (tx) => issueStock(tx, { ...base, qtyBase: new D(16) }))).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('adds a landed cost to the average and takes a receipt back at its own cost', async () => {
    const item = await run(A, (tx) => createItem(tx, A, rice));
    const main = await run(A, (tx) => warehouseOfKind(tx, A, 'MAIN'));
    const base = { restaurantId: A, itemId: item.id, warehouseId: main.id, ref: REF, user: { id: USER } };
    await run(A, (tx) => receiveStock(tx, { ...base, qtyBase: new D(10), unitCostIqd: new D(100) }));
    await run(A, (tx) => recostOnHand(tx, A, item.id, main.id, new D(100), { ref: REF, user: { id: USER } }));
    const bal = await run(A, (tx) => tx.whStockBalance.findFirstOrThrow({ where: { itemId: item.id } }));
    expect(bal.avgCostIqd.toFixed()).toBe('110');
    await run(A, (tx) => receiveStock(tx, { ...base, qtyBase: new D(10), unitCostIqd: new D(200) }));
    await run(A, (tx) => reverseReceipt(tx, { ...base, qtyBase: new D(10), unitCostIqd: new D(200) }));
    const after = await run(A, (tx) => tx.whStockBalance.findFirstOrThrow({ where: { itemId: item.id } }));
    expect(after.qtyBase.toFixed()).toBe('10');
    expect(after.avgCostIqd.toFixed()).toBe('110');
  });

  it('moves stock from the main warehouse to a rep warehouse, and a rep sees only his own', async () => {
    const item = await run(A, (tx) => createItem(tx, A, rice));
    const main = await run(A, (tx) => warehouseOfKind(tx, A, 'MAIN'));
    await prisma().user.create({ data: { id: 'u-rep', name: 'Rep One', email: 'rep1@example.com' } });
    await prisma().whStaff.create({ data: { restaurantId: A, userId: 'u-rep', role: 'REP' } });
    const repWh = await run(A, (tx) => createRepWarehouse(tx, A, 'u-rep'));
    await expect(run(A, (tx) => createRepWarehouse(tx, A, 'u-rep'))).rejects.toThrow(/already has a warehouse/);
    const staff = await prisma().whStaff.findFirstOrThrow({ where: { userId: 'u-rep' } });
    expect(staff.warehouseId).toBe(repWh.id);
    await run(A, (tx) => receiveStock(tx, { restaurantId: A, itemId: item.id, warehouseId: main.id, qtyBase: new D(100), unitCostIqd: new D(50), ref: REF, user: { id: USER } }));
    await run(A, (tx) => transferMainToRep(tx, A, USER, { itemId: item.id, toWarehouseId: repWh.id, qtyBase: '30' }));
    expect((await run(A, (tx) => onHand(tx, A, item.id, main.id))).toFixed()).toBe('70');
    expect((await run(A, (tx) => onHand(tx, A, item.id, repWh.id))).toFixed()).toBe('30');
    const partnerView = await run(A, (tx) => stockFor(tx, A, { role: 'PARTNER', userId: USER, canSeeCost: true }));
    const repView = await run(A, (tx) => stockFor(tx, A, { role: 'REP', userId: 'u-rep', canSeeCost: false }));
    expect(partnerView).toHaveLength(2);
    expect('avgCostIqd' in partnerView[0]!).toBe(true);
    expect(repView).toHaveLength(1);
    expect(repView[0]!.warehouseId).toBe(repWh.id);
    expect('avgCostIqd' in repView[0]!).toBe(false);
  });

  it('refuses another company’s item or warehouse', async () => {
    const item = await run(A, (tx) => createItem(tx, A, rice));
    const mainB = await run(B, (tx) => warehouseOfKind(tx, B, 'MAIN'));
    await expect(run(A, (tx) => receiveStock(tx, { restaurantId: A, itemId: item.id, warehouseId: mainB.id, qtyBase: new D(1), unitCostIqd: new D(1), ref: REF, user: { id: USER } }))).rejects.toThrow(/unknown warehouse/);
    await expect(run(B, (tx) => receiveStock(tx, { restaurantId: B, itemId: item.id, warehouseId: mainB.id, qtyBase: new D(1), unitCostIqd: new D(1), ref: REF, user: { id: USER } }))).rejects.toThrow(/unknown item/);
  });

  it('keeps a batch with its expiry through a transfer, oldest expiry out first', async () => {
    const item = await run(A, (tx) => createItem(tx, A, rice));
    const main = await run(A, (tx) => warehouseOfKind(tx, A, 'MAIN'));
    const damage = await run(A, (tx) => warehouseOfKind(tx, A, 'DAMAGE'));
    const base = { restaurantId: A, itemId: item.id, warehouseId: main.id, ref: REF, user: { id: USER } };
    await run(A, (tx) => receiveStock(tx, { ...base, qtyBase: new D(5), unitCostIqd: new D(10), expiry: '2027-06-01' }));
    await run(A, (tx) => receiveStock(tx, { ...base, qtyBase: new D(5), unitCostIqd: new D(10), expiry: '2027-01-01' }));
    await run(A, (tx) => transferStock(tx, { restaurantId: A, itemId: item.id, fromWarehouseId: main.id, toWarehouseId: damage.id, qtyBase: new D(5), ref: REF, user: { id: USER } }));
    const moved = await run(A, (tx) => tx.whBatch.findMany({ where: { warehouseId: damage.id, qtyBase: { gt: 0 } } }));
    expect(moved.map((b) => b.expiry?.toISOString().slice(0, 10))).toEqual(['2027-01-01']);
  });
});
