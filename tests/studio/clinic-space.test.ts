import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as appPlanActions from '@/server/studio/actions/app-plans';
import * as billingActions from '@/server/studio/actions/billing';
import * as clinicActions from '@/server/studio/actions/clinic';
import * as restaurantActions from '@/server/studio/actions/restaurants';
import * as appPlanQueries from '@/server/studio/queries/app-plans';
import * as clinicQueries from '@/server/studio/queries/clinics';
import * as pharmacyQueries from '@/server/studio/queries/pharmacies';
import * as restaurantQueries from '@/server/studio/queries/restaurants';
import { seedApplications } from '../../prisma/seed/applications';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Making, listing and changing clinics from the Clinics space, and keeping them out of every other space. */

const prisma = () => getPrisma();
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown = {}) => runQuery(prisma(), actor, def, input);
const act = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, { ip: '203.0.113.9', userAgent: 'vitest clinic' });

let admin: Actor;

async function person(id: string, memberships: Array<[string, 'OWNER']> = [], superAdmin = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name: id, email: `${id}@example.com`, isSuperAdmin: superAdmin, isPlatformOwner: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

const newClinic = (name: string, extra: Record<string, unknown> = {}) =>
  act(admin, restaurantActions.createRestaurant, { name, type: 'OTHER', sector: 'CLINIC', branches: [{ name: 'Main' }], currencies: ['IQD', 'USD'], ...extra });

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  await resetTestData(prisma());
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await seedApplications(prisma());
  admin = await person('admin', [], true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('making a clinic', () => {
  it('creates the business, its branch, its settings and one audit row, with no personal field in it', async () => {
    const { restaurantId } = dataOf(await newClinic('Smile Clinic', { ownerEmail: 'doctor@example.com' }));
    const business = await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurantId }, include: { clSettings: true, branches: true } });
    expect(business.sector).toBe('CLINIC');
    expect(business.branches.map((branch) => branch.name)).toEqual(['Main']);
    expect(business.clSettings).toMatchObject({ enabledCurrencies: ['IQD', 'USD'], defaultCurrency: 'IQD', sharePrivateNotes: false, timeZone: 'Asia/Baghdad' });
    const rows = await prisma().auditLog.findMany({ where: { restaurantId, action: 'restaurant.created' } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.changes)).not.toContain('doctor@example.com');
  });

  it('invites the owner to Clinics’ own sign-in: a clinic invitation, and no Studio invitation or user', async () => {
    const { restaurantId } = dataOf(await newClinic('Smile Clinic', { ownerEmail: 'doctor@example.com' }));
    const invitations = await prisma().clInvitation.findMany({ where: { restaurantId } });
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({ email: 'doctor@example.com', role: 'OWNER', acceptedAt: null });
    expect(await prisma().invitation.count({ where: { restaurantId } })).toBe(0);
    const rows = await prisma().auditLog.findMany({ where: { restaurantId, action: 'invitation.created' } });
    expect(rows.map((row) => row.entityType)).toEqual(['ClInvitation']);
  });

  it('is made by the Clinics form alone: the space decides the sector, and another space cannot make one', async () => {
    const viaSpace = dataOf(await act(admin, restaurantActions.createRestaurant, { name: 'Via space', type: 'OTHER', space: 'clinic', branches: [{ name: 'Main' }] }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: viaSpace.restaurantId } })).sector).toBe('CLINIC');
    const fromPharmacy = dataOf(await act(admin, restaurantActions.createRestaurant, { name: 'From pharmacy', type: 'OTHER', space: 'pharmacy', sector: 'CLINIC', branches: [{ name: 'Main' }] }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: fromPharmacy.restaurantId } })).sector).toBe('PHARMACY');
  });

  it('refuses a clinic without a branch', async () => {
    expect(codeOf(await newClinic('No branch', { branches: [] }))).toBe('INVALID');
    expect(await prisma().restaurant.count({ where: { sector: 'CLINIC' } })).toBe(0);
  });
});

describe('listing clinics', () => {
  it('lists only clinics, and no other list shows one', async () => {
    const { restaurantId } = dataOf(await newClinic('Smile Clinic'));
    await prisma().restaurant.create({ data: { name: 'Cafe' } });
    await prisma().restaurant.create({ data: { name: 'Pharmacy', sector: 'PHARMACY' } });
    const listed = dataOf(await ask(admin, clinicQueries.listClinics));
    expect(listed.rows.map((row) => row.id)).toEqual([restaurantId]);
    expect(listed.rows[0]).toMatchObject({ name: 'Smile Clinic', branches: 1, subscription: null });
    const pharmacies = dataOf(await ask(admin, pharmacyQueries.listPharmacies));
    expect(pharmacies.rows.map((row) => row.id)).not.toContain(restaurantId);
    const food = dataOf(await ask(admin, restaurantQueries.listRestaurants, { space: 'food' }));
    expect(JSON.stringify(food)).not.toContain(restaurantId);
  });
});

describe('clinic settings', () => {
  it('changes whether doctors share private notes, audited, and refuses a business that is not a clinic', async () => {
    const { restaurantId } = dataOf(await newClinic('Smile Clinic'));
    const settings = await prisma().clSettings.findUniqueOrThrow({ where: { restaurantId } });
    dataOf(await act(admin, clinicActions.updateClinicSettings, { restaurantId, sharePrivateNotes: true, version: settings.version }));
    expect((await prisma().clSettings.findUniqueOrThrow({ where: { restaurantId } })).sharePrivateNotes).toBe(true);
    const audit = await prisma().auditLog.findMany({ where: { restaurantId, action: 'clinic.settings_changed' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.changes).toMatchObject({ sharePrivateNotes: { before: false, after: true } });

    const cafe = await prisma().restaurant.create({ data: { name: 'Cafe' } });
    expect(codeOf(await act(admin, clinicActions.updateClinicSettings, { restaurantId: cafe.id, sharePrivateNotes: true, version: 1 }))).toBe('NOT_FOUND');
  });

  it('is changed only by a Super Admin, never by the clinic’s own owner', async () => {
    const { restaurantId } = dataOf(await newClinic('Smile Clinic'));
    const owner = await person('clinic-owner', [[restaurantId, 'OWNER']]);
    expect(codeOf(await act(owner, clinicActions.updateClinicSettings, { restaurantId, sharePrivateNotes: true, version: 1 }))).toBe('FORBIDDEN');
  });
});

describe('Clinics plans', () => {
  const plan = { applicationId: 'clinic', code: 'solo', name: { en: 'Solo', ar: 'منفرد', ckb: 'تاک' }, sortOrder: 0, active: true, limits: { maxDoctors: 1 } };

  it('carry clinic limits only, appear only in the clinic plan list, and are taken by a clinic alone', async () => {
    expect(codeOf(await act(admin, appPlanActions.upsert, { ...plan, limits: { maxPatients: 5 } }))).toBe('INVALID');
    dataOf(await act(admin, appPlanActions.upsert, plan));
    const list = dataOf(await ask(admin, appPlanQueries.appPlansList, { applicationId: 'clinic' }));
    expect(list.plans.map((row) => [row.code, row.limits])).toEqual([['solo', { maxDoctors: 1 }]]);
    for (const applicationId of ['pharmacy', 'retail', 'wholesale'] as const) {
      expect(dataOf(await ask(admin, appPlanQueries.appPlansList, { applicationId })).plans).toEqual([]);
    }
    await prisma().application.update({ where: { id: 'clinic' }, data: { status: 'ACTIVE' } });
    await prisma().planPrice.create({ data: { applicationId: 'clinic', planCode: 'solo', currency: 'USD', period: 'MONTHLY', amountMinor: 3_000 } });
    const { restaurantId } = dataOf(await newClinic('Smile Clinic'));
    const trial = { restaurantId, applicationId: 'clinic', planCode: 'solo', trialDays: 14, period: 'MONTHLY', currency: 'USD' };
    dataOf(await act(admin, billingActions.startTrial, trial));
    const listed = dataOf(await ask(admin, clinicQueries.listClinics)).rows[0]!;
    expect(listed.subscription).toMatchObject({ status: 'TRIAL', planCode: 'solo', trial: true });
    // A café cannot take the Clinics product, and a clinic cannot take the Menu's.
    const cafe = await prisma().restaurant.create({ data: { name: 'Cafe' } });
    expect(codeOf(await act(admin, billingActions.startTrial, { ...trial, restaurantId: cafe.id }))).toBe('CONFLICT');
    expect(codeOf(await act(admin, billingActions.startTrial, { ...trial, applicationId: 'menu', planCode: 'BASIC' }))).toBe('CONFLICT');
  });
});
