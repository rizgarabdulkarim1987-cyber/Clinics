import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Clinic accounts exist only for Clinics: their own tables, no link to a Studio user, one account for many clinics. */

const prisma = () => getPrisma();

const business = (id: string) =>
  prisma().restaurant.create({ data: { id, name: id, type: 'OTHER', sector: 'CLINIC' } });

const account = (email: string) => prisma().clAccount.create({ data: { name: email, email, passwordHash: 'hash' } });

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
});

describe('clinic accounts', () => {
  it('lets one account work in two clinics, with a role in each', async () => {
    await business('clinic-a');
    await business('clinic-b');
    const person = await account('dr@example.com');
    await prisma().clMember.create({ data: { accountId: person.id, restaurantId: 'clinic-a', role: 'DOCTOR' } });
    await prisma().clMember.create({ data: { accountId: person.id, restaurantId: 'clinic-b', role: 'RECEPTION' } });
    const members = await prisma().clMember.findMany({ where: { accountId: person.id }, orderBy: { restaurantId: 'asc' } });
    expect(members.map((member) => [member.restaurantId, member.role, member.status])).toEqual([
      ['clinic-a', 'DOCTOR', 'ACTIVE'],
      ['clinic-b', 'RECEPTION', 'ACTIVE'],
    ]);
  });

  it('refuses a second account with the same email, and a second membership in the same clinic', async () => {
    await business('clinic-a');
    const person = await account('dr@example.com');
    await expect(account('dr@example.com')).rejects.toThrow();
    await prisma().clMember.create({ data: { accountId: person.id, restaurantId: 'clinic-a', role: 'DOCTOR' } });
    await expect(prisma().clMember.create({ data: { accountId: person.id, restaurantId: 'clinic-a', role: 'CASHIER' } })).rejects.toThrow();
  });

  it('removes a clinic’s members with the clinic and keeps the account', async () => {
    await business('clinic-a');
    const person = await account('dr@example.com');
    await prisma().clMember.create({ data: { accountId: person.id, restaurantId: 'clinic-a', role: 'OWNER' } });
    await prisma().restaurant.delete({ where: { id: 'clinic-a' } });
    expect(await prisma().clMember.count()).toBe(0);
    expect(await prisma().clAccount.count()).toBe(1);
  });

  it('removes an account’s sessions and memberships with the account', async () => {
    await business('clinic-a');
    const person = await account('dr@example.com');
    await prisma().clMember.create({ data: { accountId: person.id, restaurantId: 'clinic-a', role: 'OWNER' } });
    await prisma().clSession.create({ data: { accountId: person.id, tokenHash: 'abc', expiresAt: new Date(Date.now() + 60_000) } });
    await prisma().clAccount.delete({ where: { id: person.id } });
    expect(await prisma().clSession.count()).toBe(0);
    expect(await prisma().clMember.count()).toBe(0);
  });
});
