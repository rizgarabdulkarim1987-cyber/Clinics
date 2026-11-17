import { z } from 'zod';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineClAction, loadClMemberships, runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** What a clinic action may do: only for a signed-in member, in their own clinic, in a role that is allowed. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';

type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

const clinic = (id: string, status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' = 'ACTIVE') =>
  prisma().restaurant.create({ data: { id, name: id, type: 'OTHER', sector: 'CLINIC', status } });

async function person(email: string, memberships: Array<[string, Role]>, memberStatus: 'ACTIVE' | 'DISABLED' = 'ACTIVE'): Promise<ClSessionView> {
  const { id } = await createClAccount(prisma(), { name: email, email, password: PASSWORD });
  for (const [restaurantId, role] of memberships) await prisma().clMember.create({ data: { accountId: id, restaurantId, role, status: memberStatus } });
  return { sessionId: 's', accountId: id, name: email, email };
}

/** Counts the members the clinic's own client can see: a scoped client sees one clinic only. */
const countMembers = defineClAction({
  name: 'test.countMembers',
  roles: ['OWNER', 'DOCTOR'],
  input: z.object({ note: z.string().max(10).optional() }),
  run: async (ctx) => ({ restaurantId: ctx.restaurantId, role: ctx.member.role, seen: await ctx.db.clMember.count() }),
});

const writes = defineClAction({
  name: 'test.writes',
  roles: ['OWNER'],
  input: z.object({}),
  run: async (ctx) => {
    ctx.audit({ action: 'clinic.settings_changed', entityType: 'ClSettings', entityId: 'x', changes: { a: { before: 1, after: 2 } } });
    return null;
  },
});

const fails = defineClAction({
  name: 'test.fails',
  roles: ['OWNER'],
  input: z.object({}),
  run: async (ctx) => {
    ctx.audit({ action: 'clinic.settings_changed', entityType: 'ClSettings', entityId: 'x', changes: {} });
    throw new Error('boom');
  },
});

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await clinic('clinic-a');
  await clinic('clinic-b');
});

describe('who may run a clinic action', () => {
  it('refuses nobody signed in', async () => {
    expect(code(await runClAction(prisma(), null, countMembers, {}))).toBe('UNAUTHENTICATED');
  });

  it('runs for a member in an allowed role, on that clinic alone', async () => {
    await person('b@example.com', [['clinic-b', 'DOCTOR']]);
    const owner = await person('a@example.com', [['clinic-a', 'OWNER']]);
    const result = await runClAction(prisma(), owner, countMembers, {});
    expect(result).toEqual({ ok: true, data: { restaurantId: 'clinic-a', role: 'OWNER', seen: 1 } });
  });

  it('refuses a role the action does not list, with the server and not the menu doing the refusing', async () => {
    const reception = await person('r@example.com', [['clinic-a', 'RECEPTION']]);
    expect(code(await runClAction(prisma(), reception, countMembers, {}))).toBe('FORBIDDEN');
  });

  it('answers NOT FOUND for another clinic’s id, as for a clinic that does not exist', async () => {
    const owner = await person('a@example.com', [['clinic-a', 'OWNER']]);
    expect(code(await runClAction(prisma(), owner, countMembers, {}, { restaurantId: 'clinic-b' }))).toBe('NOT_FOUND');
    expect(code(await runClAction(prisma(), owner, countMembers, {}, { restaurantId: 'nope' }))).toBe('NOT_FOUND');
  });

  it('asks a person with two clinics to choose one, and runs for the one chosen', async () => {
    const both = await person('x@example.com', [['clinic-a', 'OWNER'], ['clinic-b', 'DOCTOR']]);
    expect(code(await runClAction(prisma(), both, countMembers, {}))).toBe('INVALID');
    const result = await runClAction(prisma(), both, countMembers, {}, { restaurantId: 'clinic-b' });
    expect(result).toMatchObject({ ok: true, data: { restaurantId: 'clinic-b', role: 'DOCTOR' } });
  });

  it('does not know a disabled member, and refuses a clinic that is suspended or archived', async () => {
    const disabled = await person('d@example.com', [['clinic-a', 'OWNER']], 'DISABLED');
    expect(code(await runClAction(prisma(), disabled, countMembers, {}))).toBe('NOT_FOUND');
    await clinic('clinic-s', 'SUSPENDED');
    await clinic('clinic-z', 'ARCHIVED');
    const s = await person('s@example.com', [['clinic-s', 'OWNER']]);
    const z = await person('z@example.com', [['clinic-z', 'OWNER']]);
    expect(code(await runClAction(prisma(), s, countMembers, {}))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), z, countMembers, {}))).toBe('FORBIDDEN');
  });

  it('does not count a member of something that is not a clinic', async () => {
    await prisma().restaurant.create({ data: { id: 'shop', name: 'shop', type: 'OTHER', sector: 'RETAIL' } });
    const odd = await person('o@example.com', [['shop', 'OWNER']]);
    expect(await loadClMemberships(prisma(), odd.accountId)).toEqual([]);
    expect(code(await runClAction(prisma(), odd, countMembers, {}))).toBe('NOT_FOUND');
  });

  it('checks the input', async () => {
    const owner = await person('a@example.com', [['clinic-a', 'OWNER']]);
    expect(code(await runClAction(prisma(), owner, countMembers, { note: 'far too long for this field' }))).toBe('INVALID');
  });
});

describe('what a clinic action leaves behind', () => {
  it('writes its audit rows with the account and clinic, after it succeeds', async () => {
    const owner = await person('a@example.com', [['clinic-a', 'OWNER']]);
    await runClAction(prisma(), owner, writes, {}, {}, { ip: '203.0.113.9', userAgent: 'vitest' });
    const rows = await prisma().auditLog.findMany({ where: { restaurantId: 'clinic-a' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: owner.accountId, action: 'clinic.settings_changed', ip: '203.0.113.9' });
  });

  it('writes none when the action throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const owner = await person('a@example.com', [['clinic-a', 'OWNER']]);
    await expect(runClAction(prisma(), owner, fails, {})).rejects.toThrow('boom');
    expect(await prisma().auditLog.count({ where: { restaurantId: 'clinic-a' } })).toBe(0);
  });
});
