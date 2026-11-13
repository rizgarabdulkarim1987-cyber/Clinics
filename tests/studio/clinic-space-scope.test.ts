import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { applicationsOfSector, APPLICATIONS_OF, auditSpaceWhere, sectorOf, spaceOfBusiness as scopeSpaceOfBusiness, type BusinessSpace } from '@/server/studio/services/space-scope';
import { businessBase, businessPath, SPACES, sectorOfSpace, spaceOfBusiness, spaceOfPath } from '@/studio/spaces';
import { spaceNav } from '@/studio/nav';
import { seedApplications } from '../../prisma/seed/applications';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The Clinics space: registered like the others, and closed to them in the data. */

const prisma = () => getPrisma();
const ALL_SPACES: BusinessSpace[] = ['food', 'pharmacy', 'supermarket', 'wholesale', 'clinic'];

describe('Clinics in the space registry', () => {
  it('is a big hub entry of its own with the CLINIC sector and the /studio/clinic prefix', () => {
    const space = SPACES.find((entry) => entry.id === 'clinic');
    expect(space).toMatchObject({ nameKey: 'hub.clinic', home: '/studio/clinic', sectors: ['CLINIC'], prefix: '/studio/clinic', big: true });
  });

  it('knows a clinic business, its address and its sector', () => {
    expect(spaceOfBusiness('CLINIC')).toBe('clinic');
    expect(scopeSpaceOfBusiness('CLINIC')).toBe('clinic');
    expect(sectorOfSpace('clinic')).toBe('CLINIC');
    expect(sectorOf('clinic')).toBe('CLINIC');
    expect(businessBase('clinic')).toBe('/studio/clinic');
    expect(businessPath('clinic', 'abc')).toBe('/studio/clinic/abc');
    expect(businessPath('clinic', 'abc', 'billing')).toBe('/studio/clinic/abc/billing');
  });

  it('claims its own addresses and no other space claims them', () => {
    expect(spaceOfPath('/studio/clinic')).toBe('clinic');
    expect(spaceOfPath('/studio/clinic/abc/people')).toBe('clinic');
    expect(spaceOfPath('/studio/clinics')).toBe('food');
    expect(spaceOfPath('/studio/pharmacy/abc')).toBe('pharmacy');
  });

  it('is billed on the clinic product only, and the clinic product is billed to no other sector', () => {
    expect(APPLICATIONS_OF.clinic).toEqual(['clinic']);
    expect(applicationsOfSector('CLINIC')).toEqual(['clinic']);
    for (const sector of ['FOOD', 'PHARMACY', 'RETAIL', 'WHOLESALE'] as const) expect(applicationsOfSector(sector)).not.toContain('clinic');
  });

  it('has a sidebar of its own with nothing of another space in it', () => {
    const items = spaceNav('clinic');
    expect(items.map((item) => item.key)).toEqual(['clinicOverview', 'clinic', 'clinicBilling', 'clinicPeople', 'clinicAnnouncements', 'clinicActivity', 'clinicSettings']);
    for (const item of items) expect(item.href.startsWith('/studio/clinic')).toBe(true);
  });
});

describe('Clinics in the data', () => {
  beforeAll(async () => {
    requireTestDb();
    vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
    await resetTestData(prisma());
  });

  beforeEach(async () => {
    await resetTestData(prisma());
    await seedApplications(prisma());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('puts every audit row in exactly one space: a clinic row in Clinics alone, and nobody else’s in Clinics', async () => {
    const [cafe, pharmacy, shop, company, clinic] = await Promise.all([
      prisma().restaurant.create({ data: { name: 'Cafe' } }),
      prisma().restaurant.create({ data: { name: 'Pharmacy', sector: 'PHARMACY' } }),
      prisma().restaurant.create({ data: { name: 'Shop', sector: 'RETAIL' } }),
      prisma().restaurant.create({ data: { name: 'Company', sector: 'WHOLESALE' } }),
      prisma().restaurant.create({ data: { name: 'Clinic', sector: 'CLINIC' } }),
    ]);
    const clinicPlan = await prisma().appPlan.create({ data: { applicationId: 'clinic', code: 'solo', name: { en: 'Solo', ar: 'منفرد', ckb: 'تاک' }, limits: {} } });
    const note = await prisma().announcement.create({ data: { titles: {}, bodies: {}, space: 'clinic' }, select: { id: true } });
    const rows = [
      { restaurantId: cafe.id, action: 'restaurant.rename', entityType: 'Restaurant', entityId: cafe.id },
      { restaurantId: pharmacy.id, action: 'restaurant.rename', entityType: 'Restaurant', entityId: pharmacy.id },
      { restaurantId: shop.id, action: 'restaurant.rename', entityType: 'Restaurant', entityId: shop.id },
      { restaurantId: company.id, action: 'restaurant.rename', entityType: 'Restaurant', entityId: company.id },
      { restaurantId: clinic.id, action: 'restaurant.rename', entityType: 'Restaurant', entityId: clinic.id },
      { restaurantId: clinic.id, action: 'clinic.settings_changed', entityType: 'ClSettings', entityId: clinic.id },
      { action: 'app_plan.updated', entityType: 'AppPlan', entityId: clinicPlan.id },
      { action: 'announcement.created', entityType: 'Announcement', entityId: note.id },
    ];
    await prisma().auditLog.createMany({ data: rows });

    const idsIn = async (space: BusinessSpace) =>
      (await prisma().auditLog.findMany({ where: await auditSpaceWhere(prisma(), space), select: { entityId: true, action: true } })).map((row) => `${row.action}:${row.entityId}`);
    const clinicRows = await idsIn('clinic');
    expect(clinicRows.sort()).toEqual(
      [`restaurant.rename:${clinic.id}`, `clinic.settings_changed:${clinic.id}`, `app_plan.updated:${clinicPlan.id}`, `announcement.created:${note.id}`].sort(),
    );
    for (const space of ALL_SPACES.filter((entry) => entry !== 'clinic')) {
      const others = await idsIn(space);
      expect(others, `${space} must show no clinic row`).not.toContain(`restaurant.rename:${clinic.id}`);
      expect(others, `${space} must show no clinic row`).not.toContain(`clinic.settings_changed:${clinic.id}`);
      expect(others, `${space} must show no clinic plan`).not.toContain(`app_plan.updated:${clinicPlan.id}`);
      expect(others, `${space} must show no clinic announcement`).not.toContain(`announcement.created:${note.id}`);
    }
  });
});
