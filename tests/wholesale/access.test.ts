import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as catalogActions from '@/server/wholesale/actions/catalog';
import * as purchaseActions from '@/server/wholesale/actions/purchase';
import * as purchaseQueries from '@/server/wholesale/queries/purchase';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import * as catalogQueries from '@/server/wholesale/queries/catalog';
import { seedApplications } from '../../prisma/seed/applications';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/**
 * A wholesale company through the Studio framework: the partner (owner of the company, or a staff row) does everything, the rep
 * sells and sees his own warehouse and nothing else, a stranger and the other company get "forbidden", and a company whose
 * subscription has lapsed can still be read but not changed.
 */

const prisma = () => getPrisma();
const DAY = 86_400_000;
const meta = { ip: '203.0.113.9', userAgent: 'vitest wholesale' };
const act = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, meta);
const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), actor, def, input);
const codeOf = (r: ActionResult<unknown>) => (r.ok ? 'OK' : r.error.code);
const dataOf = <T>(r: ActionResult<T>): T => {
  if (!r.ok) throw new Error(`expected success, got ${JSON.stringify(r.error)}`);
  return r.data;
};

let A: string;
let B: string;
let owner: Actor;
let partner: Actor;
let rep: Actor;
let stranger: Actor;
let ownerOfB: Actor;

async function person(id: string, name: string, memberOf?: string): Promise<Actor> {
  await prisma().user.create({ data: { id, name, email: `${id}@example.com` } });
  if (memberOf) await prisma().membership.create({ data: { userId: id, restaurantId: memberOf, role: 'OWNER' } });
  return (await loadActor(prisma(), id)) as Actor;
}

async function subscribe(restaurantId: string, endsInDays = 29) {
  await prisma().subscription.create({
    data: {
      restaurantId,
      applicationId: 'wholesale',
      planCode: 'standard',
      status: 'ACTIVE',
      period: 'MONTHLY',
      currency: 'IQD',
      priceMinor: 0,
      currentPeriodStart: new Date(Date.now() - DAY),
      currentPeriodEnd: new Date(Date.now() + endsInDays * DAY),
      graceDays: 7,
      version: 1,
    },
  });
}

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

afterAll(async () => {
  await resetTestData(prisma());
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await seedApplications(prisma());
  // The platform's kill switch for the product is off until launch.
  await prisma().application.update({ where: { id: 'wholesale' }, data: { status: 'ACTIVE' } });
  A = (await prisma().restaurant.create({ data: { name: 'Company A', sector: 'WHOLESALE' } })).id;
  B = (await prisma().restaurant.create({ data: { name: 'Company B', sector: 'WHOLESALE' } })).id;
  await subscribe(A);
  await subscribe(B);
  owner = await person('u-owner', 'Owner', A);
  ownerOfB = await person('u-owner-b', 'Owner B', B);
  partner = await person('u-partner', 'Partner');
  rep = await person('u-rep', 'Rep');
  stranger = await person('u-stranger', 'Stranger');
  await prisma().whStaff.create({ data: { restaurantId: A, userId: 'u-partner', role: 'PARTNER' } });
  await prisma().whStaff.create({ data: { restaurantId: A, userId: 'u-rep', role: 'REP' } });
  dataOf(await act(owner, catalogActions.provisionAction, { restaurantId: A }));
  dataOf(await act(ownerOfB, catalogActions.provisionAction, { restaurantId: B }));
});

const rice = {
  code: 'RICE',
  names: { en: 'Rice' },
  baseUnit: 'PIECE' as const,
  units: [
    { unit: 'PIECE' as const, factorToBase: '1' },
    { unit: 'CARTON' as const, factorToBase: '12' },
  ],
};

describe('who is let into a wholesale company', () => {
  it('knows the owner, a partner and a rep by their role, and nobody else', async () => {
    expect(dataOf(await ask(owner, catalogQueries.meQuery, { restaurantId: A })).role).toBe('OWNER');
    expect(dataOf(await ask(partner, catalogQueries.meQuery, { restaurantId: A })).role).toBe('PARTNER');
    const asRep = dataOf(await ask(rep, catalogQueries.meQuery, { restaurantId: A }));
    expect(asRep.role).toBe('REP');
    expect(asRep.permissions).toContain('sale.create');
    expect(asRep.permissions).not.toContain('catalog.manage');
    expect((await ask(stranger, catalogQueries.meQuery, { restaurantId: A })).ok).toBe(false);
    // The other company's owner is nobody here.
    expect((await ask(ownerOfB, catalogQueries.meQuery, { restaurantId: A })).ok).toBe(false);
  });

  it('refuses a company that is not a wholesale company, and one without a subscription', async () => {
    const shop = (await prisma().restaurant.create({ data: { name: 'A cafe' } })).id;
    const cafeOwner = await person('u-cafe', 'Cafe owner', shop);
    expect((await ask(cafeOwner, catalogQueries.meQuery, { restaurantId: shop })).ok).toBe(false);
    const bare = (await prisma().restaurant.create({ data: { name: 'No plan', sector: 'WHOLESALE' } })).id;
    const bareOwner = await person('u-bare', 'Bare owner', bare);
    expect((await ask(bareOwner, catalogQueries.meQuery, { restaurantId: bare })).ok).toBe(false);
  });
});

describe('what each role may do', () => {
  it('lets a partner build the catalog and refuses the rep', async () => {
    const made = dataOf(await act(partner, catalogActions.createItemAction, { restaurantId: A, item: rice }));
    expect(made.code).toBe('RICE');
    expect(codeOf(await act(rep, catalogActions.createItemAction, { restaurantId: A, item: { ...rice, code: 'SUGAR' } }))).toBe('FORBIDDEN');
    // The rep may read the catalog, not the suppliers.
    const items = dataOf(await ask(rep, catalogQueries.itemsQuery, { restaurantId: A }));
    expect(items.map((i) => i.code)).toEqual(['RICE']);
    expect((await ask(rep, catalogQueries.suppliersQuery, { restaurantId: A })).ok).toBe(false);
  });

  it('gives the rep his own warehouse and nothing of the main one', async () => {
    const item = dataOf(await act(partner, catalogActions.createItemAction, { restaurantId: A, item: rice }));
    const repWh = dataOf(await act(owner, catalogActions.createRepWarehouseAction, { restaurantId: A, repUserId: 'u-rep' }));
    const main = await prisma().whWarehouse.findFirstOrThrow({ where: { restaurantId: A, kind: 'MAIN' } });
    const { receiveStock } = await import('@/server/wholesale/stock');
    const { D } = await import('@/server/domain/wholesale/money');
    const { scopedClient } = await import('@/server/data/tenant-db');
    await scopedClient(prisma(), { restaurantId: A }).$transaction((tx) =>
      receiveStock(tx, { restaurantId: A, itemId: item.id, warehouseId: main.id, qtyBase: new D(100), unitCostIqd: new D(10), ref: { type: 'T', id: '1' }, user: { id: 'u-owner' } }),
    );
    dataOf(await act(partner, catalogActions.transferToRepAction, { restaurantId: A, itemId: item.id, toWarehouseId: repWh.id, qtyBase: '40' }));
    expect(codeOf(await act(rep, catalogActions.transferToRepAction, { restaurantId: A, itemId: item.id, toWarehouseId: repWh.id, qtyBase: '1' }))).toBe('FORBIDDEN');

    const asRep = dataOf(await ask(rep, catalogQueries.stockQuery, { restaurantId: A }));
    expect(asRep.map((r) => [r.warehouseName, r.qtyBase])).toEqual([['Rep', '40']]);
    expect(asRep[0]).not.toHaveProperty('avgCostIqd');
    const asPartner = dataOf(await ask(partner, catalogQueries.stockQuery, { restaurantId: A }));
    expect(asPartner.map((r) => r.qtyBase).sort()).toEqual(['40', '60']);
    expect(asPartner[0]).toHaveProperty('avgCostIqd');
    expect(dataOf(await ask(rep, catalogQueries.warehousesQuery, { restaurantId: A })).map((w) => w.kind)).toEqual(['REP']);
  });

  it('turns an expected refusal into a plain answer', async () => {
    dataOf(await act(partner, catalogActions.createItemAction, { restaurantId: A, item: rice }));
    const again = await act(partner, catalogActions.createItemAction, { restaurantId: A, item: rice });
    expect(codeOf(again)).toBe('INVALID');
    expect(JSON.stringify(again)).toContain('item code already exists');
  });

  it('puts a person on the staff by email, and takes them off', async () => {
    await person('u-new', 'New Rep');
    dataOf(await act(owner, catalogActions.setStaffAction, { restaurantId: A, email: 'u-new@example.com', role: 'REP' }));
    expect(dataOf(await ask(owner, catalogQueries.staffQuery, { restaurantId: A })).map((s) => s.userId).sort()).toEqual(['u-new', 'u-partner', 'u-rep']);
    expect(codeOf(await act(owner, catalogActions.setStaffAction, { restaurantId: A, email: 'nobody@example.com', role: 'REP' }))).toBe('INVALID');
    dataOf(await act(owner, catalogActions.deactivateStaffAction, { restaurantId: A, userId: 'u-new' }));
    expect((await ask(await loadActor(prisma(), 'u-new') as Actor, catalogQueries.meQuery, { restaurantId: A })).ok).toBe(false);
    expect(codeOf(await act(rep, catalogActions.setStaffAction, { restaurantId: A, email: 'u-new@example.com', role: 'PARTNER' }))).toBe('FORBIDDEN');
  });
});

describe('purchases', () => {
  it('lets a partner buy in dollars and refuses the rep, the other company and a missing rate', async () => {
    const today = baghdadDate();
    dataOf(await act(partner, catalogActions.provisionAction, { restaurantId: A }));
    const item = dataOf(await act(partner, catalogActions.createItemAction, { restaurantId: A, item: rice }));
    const supplier = dataOf(await act(partner, catalogActions.saveSupplierAction, { restaurantId: A, supplier: { name: 'Gulf Foods', isForeign: true } }));
    const buy = { restaurantId: A, supplierId: supplier.id, date: today, currency: 'USD', paymentMode: 'CREDIT', lines: [{ itemId: item.id, unit: 'CARTON', qty: '2', unitPrice: '10' }] };
    // No dollar rate for today yet: refused with the reason, nothing written.
    expect(codeOf(await act(partner, purchaseActions.postPurchaseAction, buy))).toBe('INVALID');
    dataOf(await act(partner, purchaseActions.setRateAction, { restaurantId: A, date: today, currency: 'USD', iqdPer: '1500' }));
    expect(codeOf(await act(rep, purchaseActions.setRateAction, { restaurantId: A, date: today, currency: 'USD', iqdPer: '1' }))).toBe('FORBIDDEN');
    expect(codeOf(await act(rep, purchaseActions.postPurchaseAction, buy))).toBe('FORBIDDEN');
    expect(codeOf(await act(ownerOfB, purchaseActions.postPurchaseAction, buy))).toBe('FORBIDDEN');
    const made = dataOf(await act(partner, purchaseActions.postPurchaseAction, { ...buy, landedCosts: [{ kind: 'SHIPPING', amount: '5', currency: 'USD' }] }));
    const list = dataOf(await ask(partner, purchaseQueries.purchasesQuery, { restaurantId: A }));
    expect(list).toHaveLength(1);
    expect(list[0].totalOriginal).toBe('20');
    expect(dataOf(await ask(partner, purchaseQueries.purchaseQuery, { restaurantId: A, id: made.purchaseId }))?.open).toBe('20');
    expect((await ask(rep, purchaseQueries.purchasesQuery, { restaurantId: A })).ok).toBe(false);
    expect((await ask(ownerOfB, purchaseQueries.purchaseQuery, { restaurantId: B, id: made.purchaseId })).ok ? dataOf(await ask(ownerOfB, purchaseQueries.purchaseQuery, { restaurantId: B, id: made.purchaseId })) : null).toBeNull();
    // Paying more than is owed is a conflict, not a crash.
    expect(codeOf(await act(partner, purchaseActions.paySupplierAction, { restaurantId: A, supplierId: supplier.id, amount: '999', currency: 'USD', date: today }))).toBe('CONFLICT');
  });
});

describe('the wall between two companies', () => {
  it('shows each company only its own rows, however the id is named', async () => {
    const mine = dataOf(await act(owner, catalogActions.createItemAction, { restaurantId: A, item: rice }));
    dataOf(await act(ownerOfB, catalogActions.createItemAction, { restaurantId: B, item: { ...rice, code: 'TEA' } }));
    expect(dataOf(await ask(ownerOfB, catalogQueries.itemsQuery, { restaurantId: B })).map((i) => i.code)).toEqual(['TEA']);
    // B's owner cannot name A as the company, nor reach A's item while working in B.
    expect(codeOf(await act(ownerOfB, catalogActions.createItemAction, { restaurantId: A, item: { ...rice, code: 'X' } }))).toBe('FORBIDDEN');
    const touched = await act(ownerOfB, catalogActions.setPricesAction, { restaurantId: B, itemId: mine.id, prices: [{ unit: 'PIECE', priceIqd: '1' }] });
    expect(touched.ok).toBe(false);
    expect(await prisma().whPriceListEntry.count({ where: { itemId: mine.id } })).toBe(0);
  });
});

describe('a lapsed subscription', () => {
  it('can still be read, but not changed', async () => {
    dataOf(await act(owner, catalogActions.createItemAction, { restaurantId: A, item: rice }));
    await prisma().subscription.updateMany({ where: { restaurantId: A }, data: { currentPeriodEnd: new Date(Date.now() - 30 * DAY) } });
    expect(dataOf(await ask(owner, catalogQueries.itemsQuery, { restaurantId: A }))).toHaveLength(1);
    expect(codeOf(await act(owner, catalogActions.createItemAction, { restaurantId: A, item: { ...rice, code: 'LATE' } }))).toBe('FORBIDDEN');
    await prisma().subscription.updateMany({ where: { restaurantId: A }, data: { currentPeriodEnd: new Date(Date.now() - 400 * DAY) } });
    expect((await ask(owner, catalogQueries.itemsQuery, { restaurantId: A })).ok).toBe(false);
  });
});
