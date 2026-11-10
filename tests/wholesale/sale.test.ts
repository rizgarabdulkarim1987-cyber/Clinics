import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { D } from '@/server/domain/wholesale/money';
import { ForbiddenError } from '@/server/domain/wholesale/permissions';
import { OverpaymentError } from '@/server/domain/wholesale/purchase';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { createCustomer, createItem, seedCities, setItemPrices } from '@/server/wholesale/catalog';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import { postReturnTx } from '@/server/wholesale/posting/return';
import { cancelSaleTx, customerStatement, getSale, postSaleTx, receiveCustomerPaymentTx } from '@/server/wholesale/posting/sale';
import { setRate } from '@/server/wholesale/rates';
import { receiveStock } from '@/server/wholesale/stock';
import { createRepWarehouse, seedWarehouses, transferMainToRep, warehouseOfKind } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Selling in a wholesale company on a real database: discount, three currencies, a rep selling from his own warehouse, returns and exchange. */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
const run = <T>(restaurantId: string, fn: (tx: Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]) => Promise<T>) => db(restaurantId).$transaction(fn);

const today = baghdadDate();
const PARTNER = { id: 'u-partner', role: 'PARTNER' as const };
const REP = { id: 'u-rep', role: 'REP' as const };
let A: string;
let item: string;
let mainId: string;
let repWh: string;
let shop: string;
let repShop: string;

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
    item = (await createItem(tx, A, { code: 'RICE', names: { en: 'Rice', ar: 'رز', ckb: 'برنج' }, baseUnit: 'PIECE', units: [{ unit: 'PIECE', factorToBase: '1' }, { unit: 'CARTON', factorToBase: '12' }] })).id;
    await setItemPrices(tx, A, item, [{ unit: 'PIECE', priceIqd: '3000' }, { unit: 'CARTON', priceIqd: '36000' }]);
    mainId = (await warehouseOfKind(tx, A, 'MAIN')).id;
    await receiveStock(tx, { restaurantId: A, itemId: item, warehouseId: mainId, qtyBase: new D(240), unitCostIqd: new D(2000), ref: { type: 'T', id: '1' }, user: PARTNER });
    await prisma();
    await tx.whStaff.create({ data: { restaurantId: A, userId: REP.id, role: 'REP' } });
    repWh = (await createRepWarehouse(tx, A, REP.id)).id;
    await transferMainToRep(tx, A, PARTNER.id, { itemId: item, toWarehouseId: repWh, qtyBase: '60' });
    shop = (await createCustomer(tx, A, { name: 'Main shop', cityId: city.id })).id;
    repShop = (await createCustomer(tx, A, { name: 'Rep shop', cityId: city.id, repId: REP.id })).id;
  });
});

const line = (over: Record<string, unknown> = {}) => ({ itemId: item, unit: 'CARTON' as const, qty: '2', mode: 'OFFICIAL' as const, ...over });
const sell = (user: typeof PARTNER | typeof REP, over: Record<string, unknown> = {}) =>
  run(A, (tx) => postSaleTx(tx, A, user, { customerId: shop, date: today, currency: 'IQD', paymentMode: 'CASH', warehouseId: mainId, lines: [line()], ...over } as never));

async function assertBalanced() {
  const rows = await run(A, (tx) => tx.whJournalLine.findMany({ select: { entryId: true, side: true, baseIqd: true } }));
  const by = new Map<string, InstanceType<typeof D>>();
  for (const r of rows) {
    const v = new D(r.baseIqd.toString());
    by.set(r.entryId, (by.get(r.entryId) ?? new D(0)).plus(r.side === 'DR' ? v : v.neg()));
  }
  for (const v of by.values()) expect(v.abs().toNumber()).toBeLessThan(0.0001);
}

describe('selling', () => {
  it('sells by the carton for cash with a percent discount and takes the stock out', async () => {
    const { saleId, status } = await sell(PARTNER, { lines: [line({ mode: 'PERCENT', percent: '10' })] });
    expect(status).toBe('POSTED');
    const s = await run(A, (tx) => getSale(tx, PARTNER, saleId));
    // 2 cartons x 36000 = 72000, 10% off
    expect(s?.totalFinal.toString()).toBe('64800');
    const bal = await run(A, (tx) => tx.whStockBalance.findFirstOrThrow({ where: { itemId: item, warehouseId: mainId } }));
    expect(bal.qtyBase.toString()).toBe('156');
    await assertBalanced();
  });

  it('prices a market customer at the market price and falls back to the list price without one', async () => {
    const city = await prisma().whCity.findFirstOrThrow();
    const market = (await run(A, (tx) => createCustomer(tx, A, { name: 'Market shop', cityId: city.id, type: 'MARKET' }))).id;
    await run(A, (tx) => setItemPrices(tx, A, item, [{ unit: 'PIECE', priceIqd: '3000', marketPriceIqd: '3500' }, { unit: 'CARTON', priceIqd: '36000' }]));
    const piece = await sell(PARTNER, { customerId: market, lines: [line({ unit: 'PIECE', qty: '2' })] });
    expect((await run(A, (tx) => getSale(tx, PARTNER, piece.saleId)))?.totalFinal.toString()).toBe('7000');
    const carton = await sell(PARTNER, { customerId: market, lines: [line()] });
    expect((await run(A, (tx) => getSale(tx, PARTNER, carton.saleId)))?.totalFinal.toString()).toBe('72000');
    const wholesale = await sell(PARTNER, { lines: [line({ unit: 'PIECE', qty: '2' })] });
    expect((await run(A, (tx) => getSale(tx, PARTNER, wholesale.saleId)))?.totalFinal.toString()).toBe('6000');
  });

  it('sells in dollars at the day rate', async () => {
    const { saleId } = await sell(PARTNER, { currency: 'USD', lines: [line()] });
    const s = await run(A, (tx) => getSale(tx, PARTNER, saleId));
    expect(s?.totalFinal.toString()).toBe('48');
    await assertBalanced();
  });

  it('lets a rep sell only from his own warehouse to his own customers, and hides cost', async () => {
    await expect(sell(REP, { customerId: repShop })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sell(REP, { customerId: shop, warehouseId: repWh })).rejects.toBeInstanceOf(ForbiddenError);
    const { saleId } = await sell(REP, { customerId: repShop, warehouseId: repWh, currency: 'USD' });
    const s = await run(A, (tx) => getSale(tx, REP, saleId));
    expect(s).not.toBeNull();
    expect(s && 'totalCostIqd' in s).toBe(false);
    const bal = await run(A, (tx) => tx.whStockBalance.findFirstOrThrow({ where: { itemId: item, warehouseId: repWh } }));
    expect(bal.qtyBase.toString()).toBe('36');
    await assertBalanced();
  });

  it('collects a credit sale in another currency and refuses to over-collect', async () => {
    const { saleId } = await sell(PARTNER, { paymentMode: 'CREDIT', currency: 'USD' });
    await run(A, (tx) => receiveCustomerPaymentTx(tx, A, PARTNER, { customerId: shop, amount: '30000', currency: 'IQD', date: today, saleId }));
    const st = await run(A, (tx) => customerStatement(tx, PARTNER, shop));
    expect(st.balances.USD?.toFixed()).toBe('28');
    await expect(run(A, (tx) => receiveCustomerPaymentTx(tx, A, PARTNER, { customerId: shop, amount: '100', currency: 'USD', date: today }))).rejects.toBeInstanceOf(OverpaymentError);
    await assertBalanced();
  });

  it('takes returned goods back and cancels an untouched sale', async () => {
    const { saleId } = await sell(PARTNER, { paymentMode: 'CREDIT' });
    const s = await run(A, (tx) => getSale(tx, PARTNER, saleId));
    const lineId = s!.lines[0].id;
    await run(A, (tx) => postReturnTx(tx, A, PARTNER, { saleId, refund: 'DEBT_OFFSET', lines: [{ saleLineId: lineId, qty: '1', condition: 'GOOD' }] }));
    const after = await run(A, (tx) => tx.whStockBalance.findFirstOrThrow({ where: { itemId: item, warehouseId: mainId } }));
    expect(after.qtyBase.toString()).toBe('168');
    const second = await sell(PARTNER);
    await run(A, (tx) => cancelSaleTx(tx, A, PARTNER, second.saleId, 'wrong customer'));
    const restored = await run(A, (tx) => tx.whStockBalance.findFirstOrThrow({ where: { itemId: item, warehouseId: mainId } }));
    expect(restored.qtyBase.toString()).toBe('168');
    await assertBalanced();
  });
});
