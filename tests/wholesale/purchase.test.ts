import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { D } from '@/server/domain/wholesale/money';
import { OverpaymentError, PurchaseNotCancellableError } from '@/server/domain/wholesale/purchase';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { createItem, createSupplier } from '@/server/wholesale/catalog';
import { postJournal, seedChartOfAccounts } from '@/server/wholesale/ledger';
import { addLandedCostTx, cancelPurchaseTx, getPurchase, paySupplierTx, postPurchaseTx, supplierStatement } from '@/server/wholesale/posting/purchase';
import { postPurchaseReturnTx } from '@/server/wholesale/posting/purchaseReturn';
import { setRate } from '@/server/wholesale/rates';
import { onHand } from '@/server/wholesale/stock';
import { seedWarehouses, warehouseOfKind } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Purchases of a wholesale company on a real database: inside and outside Iraq, landed costs, supplier payments, cancellation and returns. */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
const run = <T>(restaurantId: string, fn: (tx: Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]) => Promise<T>) => db(restaurantId).$transaction(fn);

const USER = { id: 'u-partner' };
const today = baghdadDate();
let A: string;
let item: string;
let foreign: string;
let local: string;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  A = (await prisma().restaurant.create({ data: { name: 'Company A', sector: 'WHOLESALE' } })).id;
  await prisma().user.create({ data: { id: USER.id, name: 'Partner', email: 'partner@example.com' } });
  await run(A, async (tx) => {
    await seedWarehouses(tx, A);
    await seedChartOfAccounts(tx, A);
    await setRate(tx, A, today, 'USD', '1500');
    await setRate(tx, A, today, 'IRT', '0.04');
    item = (
      await createItem(tx, A, {
        code: 'RICE',
        names: { en: 'Rice', ar: 'رز', ckb: 'برنج' },
        baseUnit: 'PIECE',
        units: [
          { unit: 'PIECE', factorToBase: '1' },
          { unit: 'CARTON', factorToBase: '12' },
        ],
      })
    ).id;
    foreign = (await createSupplier(tx, A, { name: 'Gulf Foods', country: 'AE', isForeign: true })).id;
    local = (await createSupplier(tx, A, { name: 'Erbil Traders', isForeign: false })).id;
  });
});

const buy = (supplierId: string, over: Partial<Parameters<typeof postPurchaseTx>[3]> = {}) =>
  run(A, (tx) => postPurchaseTx(tx, A, USER, { supplierId, date: today, currency: 'USD', paymentMode: 'CREDIT', lines: [{ itemId: item, unit: 'CARTON', qty: '10', unitPrice: '100' }], ...over }));

/** Every journal entry balances in IQD. */
async function assertBalanced() {
  const rows = await run(A, (tx) => tx.whJournalLine.findMany({ select: { entryId: true, side: true, baseIqd: true } }));
  const by = new Map<string, InstanceType<typeof D>>();
  for (const r of rows) by.set(r.entryId, (by.get(r.entryId) ?? new D(0)).plus(r.side === 'DR' ? r.baseIqd.toString() : new D(r.baseIqd.toString()).neg()));
  for (const v of by.values()) expect(v.abs().toNumber()).toBeLessThan(0.0001);
}

describe('purchases', () => {
  it('buys by the carton in dollars on credit: stock in at the day rate, payable to the supplier', async () => {
    const { purchaseId } = await buy(foreign);
    const main = await run(A, (tx) => warehouseOfKind(tx, A, 'MAIN'));
    expect((await run(A, (tx) => onHand(tx, A, item, main.id))).toFixed()).toBe('120');
    const p = await run(A, (tx) => getPurchase(tx, purchaseId));
    expect(p?.totalIqd.toString()).toBe('1500000');
    expect(p?.open.toFixed()).toBe('1000');
    await assertBalanced();
  });

  it('buys in Iraq in dinars for cash', async () => {
    const { purchaseId } = await buy(local, { currency: 'IQD', paymentMode: 'CASH', lines: [{ itemId: item, unit: 'PIECE', qty: '50', unitPrice: '1000' }] });
    const p = await run(A, (tx) => getPurchase(tx, purchaseId));
    expect(p?.open.toFixed()).toBe('0');
    await assertBalanced();
  });

  it('adds shipping to a foreign purchase and raises the unit cost of what is on hand', async () => {
    const { purchaseId } = await buy(foreign);
    await run(A, (tx) => addLandedCostTx(tx, A, USER, purchaseId, { kind: 'SHIPPING', amount: '120', currency: 'USD', date: today }));
    const main = await run(A, (tx) => warehouseOfKind(tx, A, 'MAIN'));
    const bal = await run(A, (tx) => tx.whStockBalance.findFirstOrThrow({ where: { itemId: item, warehouseId: main.id } }));
    // (1000 USD + 120 USD) x 1500 / 120 pieces
    expect(new D(bal.avgCostIqd.toString()).toFixed(2)).toBe('14000.00');
    await assertBalanced();
  });

  it('pays a supplier in another currency, books the difference, and refuses to overpay', async () => {
    await buy(foreign);
    await run(A, (tx) => paySupplierTx(tx, A, USER, { supplierId: foreign, amount: '750000', currency: 'IQD', date: today }));
    const st = await run(A, (tx) => supplierStatement(tx, foreign));
    expect(st.balances.USD?.toFixed()).toBe('500');
    await expect(run(A, (tx) => paySupplierTx(tx, A, USER, { supplierId: foreign, amount: '900', currency: 'USD', date: today }))).rejects.toBeInstanceOf(OverpaymentError);
    await assertBalanced();
  });

  it('cancels an untouched purchase but not one with payments', async () => {
    const first = await buy(foreign);
    await run(A, (tx) => cancelPurchaseTx(tx, A, USER, first.purchaseId, 'wrong supplier'));
    const main = await run(A, (tx) => warehouseOfKind(tx, A, 'MAIN'));
    expect((await run(A, (tx) => onHand(tx, A, item, main.id))).toFixed()).toBe('0');
    const second = await buy(foreign);
    await run(A, (tx) => paySupplierTx(tx, A, USER, { supplierId: foreign, amount: '100', currency: 'USD', date: today }));
    await expect(run(A, (tx) => cancelPurchaseTx(tx, A, USER, second.purchaseId, 'oops'))).rejects.toBeInstanceOf(PurchaseNotCancellableError);
    await assertBalanced();
  });

  it('sends goods back to the supplier against the debt', async () => {
    const { purchaseId } = await buy(foreign);
    const lineId = (await run(A, (tx) => getPurchase(tx, purchaseId)))!.lines[0].id;
    await run(A, (tx) => postPurchaseReturnTx(tx, A, USER, { purchaseId, lines: [{ purchaseLineId: lineId, qty: '2' }] }));
    const p = await run(A, (tx) => getPurchase(tx, purchaseId));
    expect(p?.open.toFixed()).toBe('800');
    const main = await run(A, (tx) => warehouseOfKind(tx, A, 'MAIN'));
    expect((await run(A, (tx) => onHand(tx, A, item, main.id))).toFixed()).toBe('96');
    await assertBalanced();
  });

  it('refuses an entry that does not balance', async () => {
    await expect(
      run(A, (tx) => postJournal(tx, A, { date: today, memo: 'x', source: { type: 'T', id: '1' }, user: USER, lines: [{ accountCode: 'INVENTORY', side: 'DR', amount: new D(10), currency: 'IQD' }, { accountCode: 'AP', side: 'CR', amount: new D(5), currency: 'IQD' }] })),
    ).rejects.toThrow();
  });
});
