import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as announcementActions from '@/server/studio/actions/announcements';
import * as appPlanActions from '@/server/studio/actions/app-plans';
import * as billingActions from '@/server/studio/actions/billing';
import * as restaurantActions from '@/server/studio/actions/restaurants';
import * as wholesaleActions from '@/server/studio/actions/wholesale';
import * as activityQueries from '@/server/studio/queries/activity';
import * as announcementQueries from '@/server/studio/queries/announcements';
import * as appPlanQueries from '@/server/studio/queries/app-plans';
import * as billingQueries from '@/server/studio/queries/billing';
import * as overviewQueries from '@/server/studio/queries/overview';
import * as peopleQueries from '@/server/studio/queries/people';
import * as restaurantQueries from '@/server/studio/queries/restaurants';
import * as searchQueries from '@/server/studio/queries/search';
import * as wholesaleQueries from '@/server/studio/queries/wholesale';
import { auditSpaceWhere, type BusinessSpace } from '@/server/studio/services/space-scope';
import { openRoute } from '@/server/wholesale/handoff-http';
import { DEFAULT_ADMIN_URL } from '@/server/wholesale/link';
import { seedApplications } from '../../prisma/seed/applications';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/**
 * The Wholesale space seen from the data: a WHOLESALE business is listed, billed, searched, announced and logged there
 * alone, and no other space reads or writes it. Its own system's address is set by a Super Admin and opened by the handoff.
 */

const mocks = vi.hoisted(() => ({ actor: null as null | { isSuperAdmin: boolean } }));
vi.mock('@/server/studio/auth/actor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/studio/auth/actor')>();
  return { ...actual, getActor: vi.fn(async () => mocks.actor) };
});

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const prisma = () => getPrisma();

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown = {}) => runQuery(prisma(), actor, def, input);
const act = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, { ip: '203.0.113.9', userAgent: 'vitest wholesale' });
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const ALL_SPACES: BusinessSpace[] = ['food', 'pharmacy', 'supermarket', 'wholesale'];

let admin: Actor;
let staff: Actor;
let cafe: { id: string };
let clinic: { id: string };
let shop: { id: string };
let company: { id: string };

async function person(id: string, name: string, memberships: Array<[string, 'OWNER']> = [], superAdmin = false, platformOwner = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name, email: `${id}@example.com`, isSuperAdmin: superAdmin, isPlatformOwner: platformOwner, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  await resetTestData(prisma());
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await seedApplications(prisma());
  cafe = await prisma().restaurant.create({ data: { name: 'Cafe Alpha' } });
  clinic = await prisma().restaurant.create({ data: { name: 'Clinic Beta', sector: 'PHARMACY' } });
  shop = await prisma().restaurant.create({ data: { name: 'Shop Gamma', sector: 'RETAIL' } });
  company = await prisma().restaurant.create({ data: { name: 'Company Delta', sector: 'WHOLESALE' } });
  await prisma().wholesaleLink.create({ data: { restaurantId: company.id } });
  admin = await person('admin', 'Sam Admin', [], true, true);
  await person('company-owner', 'Wes Wholesale', [[company.id, 'OWNER']]);
  staff = await person('staff', 'Dee Designer', [[cafe.id, 'OWNER']]);
  await prisma().auditLog.create({ data: { restaurantId: cafe.id, action: 'restaurant.rename', entityType: 'Restaurant', entityId: cafe.id } });
  await prisma().auditLog.create({ data: { restaurantId: shop.id, action: 'restaurant.rename', entityType: 'Restaurant', entityId: shop.id } });
  await prisma().auditLog.create({ data: { restaurantId: company.id, action: 'restaurant.rename', entityType: 'Restaurant', entityId: company.id } });
  await prisma().invitation.create({
    data: { email: 'w@x.test', restaurantId: company.id, role: 'OWNER', tokenHash: 'h-wholesale', expiresAt: new Date(Date.now() + 86_400_000), invitedById: 'admin' },
  });
  mocks.actor = admin;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetTestData(prisma());
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

describe('the Wholesale space', () => {
  it('lists and bills a wholesale company there alone; no other space sees it', async () => {
    const lists = await Promise.all(ALL_SPACES.map(async (space) => dataOf(await ask(admin, restaurantQueries.listRestaurants, { space })).rows.map((row) => row.name)));
    expect(lists).toEqual([['Cafe Alpha'], ['Clinic Beta'], ['Shop Gamma'], ['Company Delta']]);
    const wholesale = dataOf(await ask(admin, billingQueries.billingRestaurants, { space: 'wholesale' }));
    expect(wholesale.rows.map((row) => row.name)).toEqual(['Company Delta']);
    expect(wholesale.applications.map((app) => app.id)).toEqual(['wholesale']);
    for (const space of ['food', 'pharmacy', 'supermarket'] as const) {
      const other = dataOf(await ask(admin, billingQueries.billingRestaurants, { space }));
      expect(other.rows.map((row) => row.name)).not.toContain('Company Delta');
      expect(other.applications.map((app) => app.id)).not.toContain('wholesale');
    }
    expect(dataOf(await ask(admin, billingQueries.billingOverview, { space: 'wholesale' })).applications.map((app) => app.id)).toEqual(['wholesale']);
    expect(dataOf(await ask(admin, billingQueries.restaurantBilling, { restaurantId: company.id })).applications.map((app) => app.id)).toEqual(['wholesale']);
  });

  it('offers a wholesale company only the Wholesale product, and a shop or café never that', async () => {
    const view = dataOf(await ask(admin, billingQueries.restaurantBilling, { restaurantId: company.id }));
    expect(view.applications.map((app) => [app.id, app.planCodes])).toEqual([['wholesale', []]]);
    for (const other of [cafe, clinic, shop]) {
      const theirs = dataOf(await ask(admin, billingQueries.restaurantBilling, { restaurantId: other.id }));
      expect(theirs.applications.map((app) => app.id)).not.toContain('wholesale');
    }
  });

  it('counts, searches, picks and lists the people of its companies only', async () => {
    expect(dataOf(await ask(admin, overviewQueries.overview, { space: 'wholesale' })).restaurants.ACTIVE).toBe(1);
    expect(dataOf(await ask(admin, searchQueries.jump, { q: 'a', space: 'wholesale' })).restaurants.map((row) => row.name)).toEqual(['Company Delta']);
    for (const space of ['food', 'pharmacy', 'supermarket'] as const) {
      expect(dataOf(await ask(admin, searchQueries.jump, { q: 'a', space })).restaurants.map((row) => row.name)).not.toContain('Company Delta');
      expect(dataOf(await ask(admin, peopleQueries.listPeople, { space })).rows.map((row) => row.userId)).not.toContain('company-owner');
    }
    expect(dataOf(await ask(admin, searchQueries.searchRestaurants, { q: '', space: 'wholesale' })).rows.map((row) => row.name)).toEqual(['Company Delta']);
    expect(dataOf(await ask(admin, peopleQueries.listPeople, { space: 'wholesale' })).rows.map((row) => row.userId)).toEqual(['company-owner']);
    expect(dataOf(await ask(admin, peopleQueries.listInvitations, { space: 'wholesale' })).rows.map((row) => row.email)).toEqual(['w@x.test']);
  });

  it('keeps its own announcements, and none of the others', async () => {
    dataOf(await act(admin, announcementActions.createAnnouncement, { titles: { en: 'Wholesale news' }, bodies: { en: 'Body' }, space: 'wholesale' }));
    const lists = await Promise.all(ALL_SPACES.map(async (space) => dataOf(await ask(admin, announcementQueries.listAnnouncements, { space })).map((row) => row.titles.en)));
    expect(lists).toEqual([[], [], [], ['Wholesale news']]);
  });

  it('refuses a write through the wrong space as not found, and writes nothing', async () => {
    for (const space of ['food', 'pharmacy', 'supermarket'] as const) {
      expect(codeOf(await act(admin, restaurantActions.setRestaurantStatus, { restaurantId: company.id, status: 'SUSPENDED', space }))).toBe('NOT_FOUND');
    }
    for (const other of [cafe, clinic, shop]) {
      expect(codeOf(await act(admin, restaurantActions.setRestaurantStatus, { restaurantId: other.id, status: 'SUSPENDED', space: 'wholesale' }))).toBe('NOT_FOUND');
    }
    expect((await prisma().restaurant.findMany({ select: { status: true } })).every((row) => row.status === 'ACTIVE')).toBe(true);
    expect(codeOf(await act(admin, restaurantActions.setRestaurantStatus, { restaurantId: company.id, status: 'SUSPENDED', space: 'wholesale' }))).toBe('OK');
  });

  it('makes a company from its own form: no branches, no owner, and an empty address of its own system', async () => {
    const made = dataOf(await act(admin, restaurantActions.createRestaurant, { name: 'Company Epsilon', type: 'OTHER', space: 'wholesale' }));
    const row = await prisma().restaurant.findUniqueOrThrow({ where: { id: made.restaurantId }, include: { wholesaleLink: true, branches: true } });
    expect(row).toMatchObject({ sector: 'WHOLESALE', wholesaleLink: { adminUrl: null }, branches: [] });
    expect((await prisma().auditLog.findFirst({ where: { action: 'restaurant.created', entityId: made.restaurantId } }))?.changes).toMatchObject({ sector: { after: 'WHOLESALE' } });
    // The same form in another space never makes a wholesale company, whatever sector it names.
    const food = dataOf(await act(admin, restaurantActions.createRestaurant, { name: 'Cafe Zeta', type: 'CAFE', sector: 'WHOLESALE', space: 'food' }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: food.restaurantId }, include: { wholesaleLink: true } })).wholesaleLink).toBeNull();
  });
});

describe('every audit row is in exactly one space, Wholesale included', () => {
  it('shares the log out among the four spaces with nothing hidden and nothing twice', async () => {
    const retailPlan = await prisma().appPlan.create({ data: { applicationId: 'retail', code: 'shop', name: { en: 'Shop', ar: 'Shop', ckb: 'Shop' } } });
    const wholesalePlan = await prisma().appPlan.create({ data: { applicationId: 'wholesale', code: 'annual', name: { en: 'Annual', ar: 'Annual', ckb: 'Annual' } } });
    const pharmacyPlan = await prisma().appPlan.create({ data: { applicationId: 'pharmacy', code: 'starter', name: { en: 'Starter', ar: 'Starter', ckb: 'Starter' } } });
    const notes = await Promise.all(ALL_SPACES.map((space) => prisma().announcement.create({ data: { titles: {}, bodies: {}, space }, select: { id: true } })));
    await prisma().auditLog.createMany({
      data: [
        { action: 'app_plan.updated', entityType: 'AppPlan', entityId: retailPlan.id },
        { action: 'app_plan.updated', entityType: 'AppPlan', entityId: wholesalePlan.id },
        { action: 'app_plan.updated', entityType: 'AppPlan', entityId: pharmacyPlan.id },
        ...notes.map((note) => ({ action: 'announcement.created', entityType: 'Announcement', entityId: note.id })),
        { restaurantId: 'gone', action: 'restaurant.rename', entityType: 'Restaurant', entityId: 'gone' },
        { restaurantId: company.id, action: 'wholesale.link_changed', entityType: 'WholesaleLink', entityId: company.id },
      ],
    });
    const all = (await prisma().auditLog.findMany({ select: { id: true } })).map((row) => row.id).sort();
    const bySpace = await Promise.all(ALL_SPACES.map(async (space) => prisma().auditLog.findMany({ where: await auditSpaceWhere(prisma(), space), select: { id: true, entityId: true } })));
    expect(bySpace.flat().map((row) => row.id).sort()).toEqual(all);
    const [food, pharmacy, supermarket, wholesale] = bySpace.map((rows) => rows.map((row) => row.entityId).sort());
    expect(wholesale).toEqual([notes[3]!.id, wholesalePlan.id, company.id, company.id].sort());
    expect(supermarket).toEqual([notes[2]!.id, retailPlan.id, shop.id].sort());
    expect(pharmacy).toEqual([notes[1]!.id, pharmacyPlan.id].sort());
    expect(food).toEqual([notes[0]!.id, cafe.id, 'gone'].sort());
  });

  it('shows Wholesale its own activity in the log and on its overview', async () => {
    expect(dataOf(await ask(admin, activityQueries.listActivity, { space: 'wholesale' })).rows.map((row) => row.entityId)).toEqual([company.id]);
    expect(dataOf(await ask(admin, overviewQueries.overview, { space: 'wholesale' })).recentActivity?.map((row) => row.entityId)).toEqual([company.id]);
  });
});

describe('Wholesale plans and a company trial', () => {
  it('makes a plan with no limits, refuses limits it does not have, and starts a trial on it', async () => {
    const plan = { applicationId: 'wholesale', code: 'annual', name: { en: 'Annual', ar: 'سنوي', ckb: 'ساڵانە' }, sortOrder: 0, active: true, limits: {} };
    expect(codeOf(await act(admin, appPlanActions.upsert, { ...plan, limits: { branches: 3 } }))).toBe('INVALID');
    dataOf(await act(admin, appPlanActions.upsert, plan));
    const list = dataOf(await ask(admin, appPlanQueries.appPlansList, { applicationId: 'wholesale' }));
    expect(list.plans.map((row) => [row.code, row.limits])).toEqual([['annual', {}]]);
    // The Pharmacy's and Retail's plan lists never carry it.
    for (const applicationId of ['pharmacy', 'retail'] as const) {
      expect(dataOf(await ask(admin, appPlanQueries.appPlansList, { applicationId })).plans).toEqual([]);
    }
    await prisma().application.update({ where: { id: 'wholesale' }, data: { status: 'ACTIVE' } });
    await prisma().planPrice.create({ data: { applicationId: 'wholesale', planCode: 'annual', currency: 'USD', period: 'YEARLY', amountMinor: 200_000 } });
    const trial = { restaurantId: company.id, applicationId: 'wholesale', planCode: 'annual', trialDays: 14, period: 'YEARLY', currency: 'USD' };
    dataOf(await act(admin, billingActions.startTrial, trial));
    const row = dataOf(await ask(admin, wholesaleQueries.wholesaleList, {})).rows[0]!;
    expect(row).toMatchObject({ name: 'Company Delta', hasAddress: false, subscription: { status: 'TRIAL', planCode: 'annual', trial: true } });
    // A café cannot take the Wholesale product.
    expect(codeOf(await act(admin, billingActions.startTrial, { ...trial, restaurantId: cafe.id }))).toBe('CONFLICT');
  });
});

describe('the address of a company’s own Wholesale system', () => {
  it('is set by a Super Admin, kept as the https address it is, cleared when emptied, and logged', async () => {
    expect(dataOf(await ask(admin, wholesaleQueries.wholesaleDetail, { restaurantId: company.id }))).toEqual({
      id: company.id,
      name: 'Company Delta',
      adminUrl: DEFAULT_ADMIN_URL,
      coreBusinessId: company.id,
      coreApplicationId: 'wholesale',
    });
    expect(dataOf(await act(admin, wholesaleActions.setLink, { restaurantId: company.id, adminUrl: ' https://al-noor.example.com/ ' }))).toEqual({ adminUrl: 'https://al-noor.example.com' });
    expect((await prisma().wholesaleLink.findUniqueOrThrow({ where: { restaurantId: company.id } })).adminUrl).toBe('https://al-noor.example.com');
    expect(await prisma().auditLog.count({ where: { action: 'wholesale.link_changed', entityId: company.id } })).toBe(1);
    // The same value again writes nothing and logs nothing.
    dataOf(await act(admin, wholesaleActions.setLink, { restaurantId: company.id, adminUrl: 'https://al-noor.example.com' }));
    expect(await prisma().auditLog.count({ where: { action: 'wholesale.link_changed' } })).toBe(1);
    expect(dataOf(await ask(admin, wholesaleQueries.wholesaleList, {})).rows[0]).toMatchObject({ hasAddress: true });
    expect(dataOf(await ask(admin, wholesaleQueries.wholesaleList, { unlinkedOnly: true })).rows).toEqual([]);
    dataOf(await act(admin, wholesaleActions.setLink, { restaurantId: company.id, adminUrl: '' }));
    expect((await prisma().wholesaleLink.findUniqueOrThrow({ where: { restaurantId: company.id } })).adminUrl).toBeNull();
  });

  it('refuses an address that is not https, carries credentials or names no domain, and a business that is no wholesale company', async () => {
    for (const adminUrl of ['http://al-noor.example.com', 'javascript:alert(1)', 'https://user:pw@al-noor.example.com', 'https://localhost', 'not a url']) {
      expect(codeOf(await act(admin, wholesaleActions.setLink, { restaurantId: company.id, adminUrl })), adminUrl).toBe('INVALID');
    }
    expect((await prisma().wholesaleLink.findUniqueOrThrow({ where: { restaurantId: company.id } })).adminUrl).toBeNull();
    for (const other of [cafe, clinic, shop]) {
      expect(codeOf(await act(admin, wholesaleActions.setLink, { restaurantId: other.id, adminUrl: 'https://x.example.com' }))).toBe('NOT_FOUND');
      expect(codeOf(await ask(admin, wholesaleQueries.wholesaleDetail, { restaurantId: other.id }))).toBe('NOT_FOUND');
    }
  });

  it('is refused to anyone who is not a Super Admin, even an owner of the company', async () => {
    const owner = (await loadActor(prisma(), 'company-owner')) as Actor;
    for (const actor of [owner, staff]) {
      expect(codeOf(await act(actor, wholesaleActions.setLink, { restaurantId: company.id, adminUrl: 'https://x.example.com' })), 'setLink').not.toBe('OK');
      expect(codeOf(await ask(actor, wholesaleQueries.wholesaleList, {})), 'list').not.toBe('OK');
      expect(codeOf(await ask(actor, wholesaleQueries.wholesaleDetail, { restaurantId: company.id })), 'detail').not.toBe('OK');
    }
  });
});

describe('the customer links of a wholesale company', () => {
  it('shows its Wholesale system link without any address saved, and its own once one is saved', async () => {
    vi.stubEnv('STUDIO_HOST', 'studio.example.test');
    const first = dataOf(await ask(admin, restaurantQueries.restaurantCustomerLinks, { restaurantId: company.id }));
    expect(first.links).toEqual([{ kind: 'wholesale', label: null, url: DEFAULT_ADMIN_URL }]);
    expect(first.message).toContain(DEFAULT_ADMIN_URL);
    dataOf(await act(admin, wholesaleActions.setLink, { restaurantId: company.id, adminUrl: 'https://al-noor.example.com' }));
    const second = dataOf(await ask(admin, restaurantQueries.restaurantCustomerLinks, { restaurantId: company.id }));
    expect(second.links.map((link) => link.url)).toEqual(['https://al-noor.example.com']);
  });
});

describe('Open Wholesale', () => {
  it('redirects a Super Admin to the company’s own system, with no token, and never caches it', async () => {
    dataOf(await act(admin, wholesaleActions.setLink, { restaurantId: company.id, adminUrl: 'https://al-noor.example.com' }));
    mocks.actor = admin;
    const response = await openRoute(company.id);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://al-noor.example.com');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('sends a company with no address of its own to the default Wholesale address', async () => {
    const response = await openRoute(company.id);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(DEFAULT_ADMIN_URL);
  });

  it('answers 404 for a business that is no company, and anyone who is not a Super Admin', async () => {
    dataOf(await act(admin, wholesaleActions.setLink, { restaurantId: company.id, adminUrl: 'https://al-noor.example.com' }));
    expect((await openRoute(cafe.id)).status).toBe(404);
    expect((await openRoute('nope')).status).toBe(404);
    mocks.actor = { isSuperAdmin: false };
    expect((await openRoute(company.id)).status).toBe(404);
    mocks.actor = null;
    expect((await openRoute(company.id)).status).toBe(404);
  });
});
