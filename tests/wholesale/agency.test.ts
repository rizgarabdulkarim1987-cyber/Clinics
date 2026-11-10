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
import { setRate } from '@/server/wholesale/rates';
import { seedWarehouses } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Agency orders on a real database: advances, costs paid for the principal, settlement, refund, collection, cancellation. */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
const run = <T>(restaurantId: string, fn: (tx: Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]) => Promise<T>) => db(restaurantId).$transaction(fn);

const today = baghdadDate();
const PARTNER = { id: 'u-partner', role: 'PARTNER' as const };
const REP = { id: 'u-rep', role: 'REP' as const };
let A: string;
let principal: string;

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
    principal = (await createCustomer(tx, A, { name: 'Principal Co', cityId: city.id })).id;
  });
});

const open = (over: Record<string, unknown> = {}) =>
  run(A, (tx) => createAgencyOrderTx(tx, A, PARTNER, { principalId: principal, title: 'Tea from Turkey', currency: 'IQD', agreedTotal: '10000000', date: today, ...over })).then((r) => r.orderId);

/** The ledger balance of one account (DR minus CR, IQD value) over all entries, and a check that every entry balances. */
async function ledger() {
  const rows = await run(A, (tx) => tx.whJournalLine.findMany({ select: { entryId: true, side: true, baseIqd: true, account: { select: { code: true } }, amount: true } }));
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

describe('agency rules (pure)', () => {
  it('applies advances against costs plus commission and pays back the rest', () => {
    const bal = agencyBalance([
      { kind: 'ADVANCE', amount: '500' },
      { kind: 'COST', amount: '300' },
    ]);
    expect(bal.advanceHeld.toString()).toBe('500');
    expect(bal.receivable.toString()).toBe('300');
    const small = planSettlement(bal, new D(100));
    expect([small.due, small.applied, small.refund, small.remaining].map(String)).toEqual(['400', '400', '100', '0']);
    const big = planSettlement(bal, new D(400));
    expect([big.due, big.applied, big.refund, big.remaining].map(String)).toEqual(['700', '500', '0', '200']);
  });
});

describe('agency orders', () => {
  it('numbers the order, keeps the principal and refuses a rep', async () => {
    const id = await open();
    const o = await run(A, (tx) => getAgencyOrder(tx, PARTNER, id));
    expect(o).toMatchObject({ title: 'Tea from Turkey', status: 'OPEN', currency: 'IQD' });
    expect(o!.principal.name).toBe('Principal Co');
    await expect(run(A, (tx) => listAgencyOrders(tx, REP))).rejects.toThrow(ForbiddenError);
    await expect(run(A, (tx) => createAgencyOrderTx(tx, A, REP, { principalId: principal, title: 'x', currency: 'IQD', agreedTotal: '1', date: today }))).rejects.toThrow(ForbiddenError);
    await expect(open({ title: ' ' })).rejects.toThrow(InvalidAgencyError);
    await expect(open({ principalId: 'nope' })).rejects.toThrow(InvalidAgencyError);
  });

  it('holds advances as a liability, in the till or in a rep custody', async () => {
    const id = await open();
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '3000000', date: today }));
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '1000000', date: today, custodyRepId: REP.id }));
    const a = await ledger();
    expect(a.CASH_IQD).toBe(3_000_000);
    expect(a.REP_CUSTODY).toBe(1_000_000);
    expect(a.CUSTOMER_ADVANCES).toBe(-4_000_000);
    const o = await run(A, (tx) => getAgencyOrder(tx, PARTNER, id));
    expect(o!.balance.advanceHeld).toBe('4000000');
    expect(o!.movements).toHaveLength(2);
    await expect(run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '0', date: today }))).rejects.toThrow();
    await expect(run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '5', date: today, custodyRepId: 'nobody' }))).rejects.toThrow(InvalidAgencyError);
  });

  it('settles: advances cover the goods, the commission is income, the rest is owed and collected', async () => {
    const id = await open();
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '6000000', date: today }));
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: id, amount: '9000000', date: today }));
    const done = await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, commission: '500000', date: today }));
    expect(done).toMatchObject({ applied: '6000000', refund: '0', remaining: '3500000', status: 'DELIVERED' });
    let a = await ledger();
    expect(a.AGENCY_COMMISSION).toBe(-500_000);
    expect(a.CUSTOMER_ADVANCES).toBe(0);
    expect(a.AGENCY_RECEIVABLE).toBe(3_500_000);
    expect(a.CASH_IQD).toBe(6_000_000 - 9_000_000);
    // the goods are not the company's: no stock, cost of goods or sales
    expect(a.INVENTORY ?? 0).toBe(0);
    expect(a.COGS ?? 0).toBe(0);
    expect(a.SALES ?? 0).toBe(0);
    await expect(run(A, (tx) => collectAgencyTx(tx, A, PARTNER, { orderId: id, amount: '3500001', date: today }))).rejects.toThrow(InvalidAgencyError);
    const part = await run(A, (tx) => collectAgencyTx(tx, A, PARTNER, { orderId: id, amount: '1000000', date: today }));
    expect(part.status).toBe('DELIVERED');
    const last = await run(A, (tx) => collectAgencyTx(tx, A, PARTNER, { orderId: id, amount: '2500000', date: today }));
    expect(last.status).toBe('CLOSED');
    a = await ledger();
    expect(a.AGENCY_RECEIVABLE).toBe(0);
    expect(a.CASH_IQD).toBe(500_000); // exactly the commission is left in the till
    const o = await run(A, (tx) => getAgencyOrder(tx, PARTNER, id));
    expect(o!.status).toBe('CLOSED');
    expect(o!.balance.receivable).toBe('0');
  });

  it('pays back an advance larger than what is owed', async () => {
    const id = await open();
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '5000000', date: today }));
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: id, amount: '3000000', date: today }));
    const done = await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, commission: '200000', date: today }));
    expect(done).toMatchObject({ applied: '3200000', refund: '1800000', remaining: '0', status: 'CLOSED' });
    const a = await ledger();
    expect(a.CASH_IQD).toBe(200_000);
    expect(a.CUSTOMER_ADVANCES).toBe(0);
    expect(a.AGENCY_RECEIVABLE).toBe(0);
    expect(a.AGENCY_COMMISSION).toBe(-200_000);
  });

  it('works in dollars at the day rate and keeps every entry balanced', async () => {
    const id = await open({ currency: 'USD', agreedTotal: '20000' });
    await run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: id, amount: '8000', date: today }));
    await run(A, (tx) => payCostTx(tx, A, PARTNER, { orderId: id, amount: '15000', date: today }));
    const done = await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, commission: '1000', date: today }));
    expect(done).toMatchObject({ applied: '8000', remaining: '8000', status: 'DELIVERED' });
    const a = await ledger();
    expect(a.AGENCY_COMMISSION).toBe(-1000 * 1500);
    expect(a.AGENCY_RECEIVABLE).toBe(8000 * 1500);
  });

  it('settles an order with no money at all and closes it', async () => {
    const id = await open();
    const done = await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, commission: '0', date: today }));
    expect(done).toMatchObject({ entryId: null, status: 'CLOSED' });
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

  it('refuses a settled order a second time and a future date', async () => {
    const id = await open();
    await run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, commission: '0', date: today }));
    await expect(run(A, (tx) => settleAgencyOrderTx(tx, A, PARTNER, { orderId: id, commission: '0', date: today }))).rejects.toThrow(InvalidAgencyError);
    const other = await open();
    await expect(run(A, (tx) => receiveAdvanceTx(tx, A, PARTNER, { orderId: other, amount: '5', date: '2099-01-01' }))).rejects.toThrow();
  });
});
