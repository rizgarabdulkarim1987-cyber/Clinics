import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { agencyBalance, planSettlement } from '@/server/domain/wholesale/agency';
import { D } from '@/server/domain/wholesale/money';
import { ForbiddenError } from '@/server/domain/wholesale/permissions';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { createCustomer, seedCities } from '@/server/wholesale/catalog';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import {
  InvalidAgencyError,
  cancelAgencyOrderTx,
  collectAgencyTx,
  createAgencyOrderTx,
  getAgencyOrder,
  listAgencyOrders,
  payCostTx,
  receiveAdvanceTx,
  settleAgencyOrderTx,
} from '@/server/wholesale/posting/agency';
import { debts, profit } from '@/server/wholesale/posting/reports';
import { setRate } from '@/server/wholesale/rates';
import { seedWarehouses } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/**
 * Special orders on a real database: a customer asks for goods from abroad, pays an advance, the company pays the costs
 * (goods, shipping, customs), and on delivery the total is a sale whose profit or loss shows in the profit report.
 */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
const run = <T>(restaurantId: string, fn: (tx: Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]) => Promise<T>) => db(restaurantId).$transaction(fn);

const today = baghdadDate();
const PARTNER = { id: 'u-partner', role: 'PARTNER' as const };
const REP = { id: 'u-rep', role: 'REP' as const };
let A: string;
let customer: string;

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
    await tx.whStaff.create({ data: { restaurantId: A, userId: REP.id, role: 'REP' } });
    const city = await tx.whCity.findFirstOrThrow();
    customer = (await createCustomer(tx, A, { name: 'Tari Trading', cityId: city.id })).id;
  });
});

const open = (over: Record<string, unknown> = {}) =>
  run(A, (tx) => createAgencyOrderTx(tx, A, PARTNER, { principalId: customer, title: 'Kazakh rice, 20 tons', currency: 'IQD', agreedTotal: '10000000', date: today, ...over })).then((r) => r.orderId);

/** The ledger balance of each account (DR minus CR, IQD value), and a check that every entry balances. */
async function ledger() {
  const rows = await run(A, (tx) => tx.whJournalLine.findMany({ select: { entryId: true, side: true, baseIqd: true, account: { select: { code: true } } } }));
  const byEntry = new Map<string, InstanceType<typeof D>>();
  const byAccount: Record<string, number> = {};
  for (const r of rows) {
    const v = new D(r.baseIqd.toString());
    const signed = r.side === 'DR' ? v : v.neg();
    byEntry.set(r.entryId, (byEntry.get(r.entryId) ?? new D(0)).plus(signed));
    byAccount[r.account.code] = (byAccount[r.account.code] ?? 0) + signed.toNumber();
  }
  for (const v of byEntry.values()) expect(v.abs().toNumber()).toBeLessThan(0.0001);
  return byAccount;
}

describe('special order rules (pure)', () => {
  it('works the profit out of the total and every cost, and applies the advance to the sale', () => {
    const bal = agencyBalance([
      { kind: 'ADVANCE', amount: '500' },
      { kind: 'COST', amount: '300' },
      { kind: 'COST', amount: '50' },
    ]);
    expect(bal.advanceHeld.toString()).toBe('500');
    expect(bal.costs.toString()).toBe('350');
    const sale = planSettlement(bal, new D(900));
    expect([sale.applied, sale.refund, sale.remaining, sale.profit].map(String)).toEqual(['500', '0', '400', '550']);
    const small = planSettlement(bal, new D(300));
    expect([small.applied, small.refund, small.remaining, small.profit].map(String)).toEqual(['300', '200', '0', '-50']);
  });
});

describe('special orders', () => {
  it('numbers the order, keeps the customer and refuses a rep', async () => {
    const id = await open();
    const o = await run(A, (tx) => getAgencyOrder(tx, PARTNER, id));
    expect(o).toMatchObject({ title: 'Kazakh rice, 20 tons', status: 'OPEN', currency: 'IQD' });
    expect(o!.principal.name).toBe('Tari Trading');
    await expect(run(A, (tx) => listAgencyOrders(tx, REP))).rejects.toThrow(ForbiddenError);
    await expect(run(A, (tx) => createAgencyOrderTx(tx, A, REP, { principalId: customer, title: 'x', currency: 'IQD', agreedTotal: '1', date: today }))).rejects.toThrow(ForbiddenError);
    await expect(open({ title: ' ' })).rejects.toThrow(InvalidAgencyError);
    await expect(open({ principalId: 'nope' })).rejects.toThrow(InvalidAgencyError);
  });

  it('takes the advance when the order is opened and the rest into the till at delivery', async () => {
    const id = await open({ advance: { amount: '4000000' } });
    expect((await ledger()).CASH_IQD).toBe(4_000_000);
    expect((await run(A, (tx) => getAgencyOrder(tx, PARTNER, id)))!.balance.advanceHeld).toBe('4000000');
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: id, amount: '7000000', date: today }));
    await expect(run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, total: '10000000', receivedNow: '6000001', date: today }))).rejects.toThrow(InvalidAgencyError);
    const done = await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, total: '10000000', receivedNow: '6000000', date: today }));
    expect(done).toMatchObject({ remaining: '0', status: 'CLOSED', profit: '3000000' });
    const a = await ledger();
    expect(a.CASH_IQD).toBe(3_000_000); // 4m advance - 7m costs + 6m paid at delivery = the profit
    expect(a.AGENCY_RECEIVABLE).toBe(0);
    expect(a.CUSTOMER_ADVANCES).toBe(0);
  });

  it('holds advances as a liability, in the till or in a rep custody', async () => {
    const id = await open();
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '3000000', date: today }));
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '1000000', date: today, custodyRepId: REP.id }));
    const a = await ledger();
    expect(a.CASH_IQD).toBe(3_000_000);
    expect(a.REP_CUSTODY).toBe(1_000_000);
    expect(a.CUSTOMER_ADVANCES).toBe(-4_000_000);
    expect((await run(A, (tx) => getAgencyOrder(tx, PARTNER, id)))!.balance.advanceHeld).toBe('4000000');
    await expect(run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '0', date: today }))).rejects.toThrow();
    await expect(run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '5', date: today, custodyRepId: 'nobody' }))).rejects.toThrow(InvalidAgencyError);
  });

  it('keeps costs out of profit until delivery, then books the sale and its profit', async () => {
    const id = await open();
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '6000000', date: today }));
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: id, amount: '7000000', category: 'GOODS', date: today }));
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: id, amount: '800000', category: 'SHIPPING', date: today }));
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: id, amount: '200000', category: 'CUSTOMS', date: today }));
    // before delivery: nothing in sales, nothing in cost of goods, no profit effect
    const before = await run(A, (tx) => profit(tx, {}));
    expect(before.salesIqd.toNumber()).toBe(0);
    expect(before.cogsIqd.toNumber()).toBe(0);
    expect((await ledger()).AGENCY_WIP).toBe(8_000_000);

    const done = await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, total: '10000000', date: today }));
    expect(done).toMatchObject({ total: '10000000', cost: '8000000', profit: '2000000', applied: '6000000', refund: '0', remaining: '4000000', status: 'DELIVERED' });
    let a = await ledger();
    expect(a.SALES).toBe(-10_000_000);
    expect(a.COGS).toBe(8_000_000);
    expect(a.AGENCY_WIP).toBe(0);
    expect(a.CUSTOMER_ADVANCES).toBe(0);
    expect(a.AGENCY_RECEIVABLE).toBe(4_000_000);
    expect(a.INVENTORY ?? 0).toBe(0); // the goods never sat in the company's stock
    const after = await run(A, (tx) => profit(tx, {}));
    expect(after.salesIqd.toNumber()).toBe(10_000_000);
    expect(after.grossIqd.toNumber()).toBe(2_000_000);
    expect((await run(A, (tx) => debts(tx))).receivable.IQD?.toNumber()).toBe(4_000_000);

    await expect(run(A, (tx) => collectAgencyTx(tx, A, PARTNER, { orderId: id, amount: '4000001', date: today }))).rejects.toThrow(InvalidAgencyError);
    expect((await run(A, (tx) => collectAgencyTx(tx, A, PARTNER, { orderId: id, amount: '1000000', date: today }))).status).toBe('DELIVERED');
    expect((await run(A, (tx) => collectAgencyTx(tx, A, PARTNER, { orderId: id, amount: '3000000', date: today }))).status).toBe('CLOSED');
    a = await ledger();
    expect(a.AGENCY_RECEIVABLE).toBe(0);
    expect(a.CASH_IQD).toBe(2_000_000); // advance + payments - costs = exactly the profit
    const o = await run(A, (tx) => getAgencyOrder(tx, PARTNER, id));
    expect(o).toMatchObject({ status: 'CLOSED', balance: { receivable: '0', profit: '2000000', costs: '8000000' } });
  });

  it('shows a loss when the costs are above the total', async () => {
    const id = await open();
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: id, amount: '9000000', date: today }));
    const done = await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, total: '8000000', date: today }));
    expect(done.profit).toBe('-1000000');
    expect((await run(A, (tx) => profit(tx, {}))).grossIqd.toNumber()).toBe(-1_000_000);
    await ledger();
  });

  it('pays back an advance larger than the total', async () => {
    const id = await open();
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '5000000', date: today }));
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: id, amount: '3000000', date: today }));
    const done = await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, total: '4000000', date: today }));
    expect(done).toMatchObject({ applied: '4000000', refund: '1000000', remaining: '0', status: 'CLOSED' });
    const a = await ledger();
    expect(a.CASH_IQD).toBe(5_000_000 - 3_000_000 - 1_000_000);
    expect(a.CUSTOMER_ADVANCES).toBe(0);
  });

  it('works in dollars at the day rate and keeps every entry balanced', async () => {
    const id = await open({ currency: 'USD', agreedTotal: '20000' });
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '8000', date: today }));
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: id, amount: '15000', date: today }));
    const done = await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, total: '20000', date: today }));
    expect(done).toMatchObject({ profit: '5000', applied: '8000', remaining: '12000', status: 'DELIVERED' });
    const a = await ledger();
    expect(a.SALES).toBe(-20000 * 1500);
    expect(a.COGS).toBe(15000 * 1500);
    expect(a.AGENCY_RECEIVABLE).toBe(12000 * 1500);
  });

  it('cancels an order and pays the advances back, but not once money was spent', async () => {
    const id = await open();
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '2000000', date: today }));
    await run(A, (tx) => cancelAgencyOrderTx(tx, A, PARTNER, { orderId: id, date: today }));
    const a = await ledger();
    expect(a.CASH_IQD).toBe(0);
    expect(a.CUSTOMER_ADVANCES).toBe(0);
    expect((await run(A, (tx) => getAgencyOrder(tx, PARTNER, id)))!.status).toBe('CANCELLED');
    await expect(run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '1', date: today }))).rejects.toThrow(InvalidAgencyError);
    const spent = await open();
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: spent, amount: '100', date: today }));
    await expect(run(A, (tx) => cancelAgencyOrderTx(tx, A, PARTNER, { orderId: spent, date: today }))).rejects.toThrow(InvalidAgencyError);
  });

  it('refuses a second delivery, an unknown cost kind and a future date', async () => {
    const id = await open();
    await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, total: '100', date: today }));
    await expect(run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, total: '100', date: today }))).rejects.toThrow(InvalidAgencyError);
    const other = await open();
    await expect(run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: other, amount: '5', category: 'GIFT', date: today }))).rejects.toThrow(InvalidAgencyError);
    await expect(run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: other, amount: '5', date: '2099-01-01' }))).rejects.toThrow();
  });
});
