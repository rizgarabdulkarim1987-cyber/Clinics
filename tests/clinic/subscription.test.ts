import { z } from 'zod';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClAccount } from '@/server/clinic/auth/sign-in';
import { clEntry } from '@/server/clinic/entry';
import { defineClAction, loadClMemberships, runClAction } from '@/server/clinic/framework';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** A clinic or beauty centre whose plan has ended is closed; one that never had a plan keeps running; grace days still work. */

const prisma = () => getPrisma();
const NOW = new Date('2026-11-17T10:00:00Z');
const DAY = 86_400_000;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

const whoAmI = defineClAction({ name: 'test.who', roles: ['OWNER'], input: z.object({}), run: async (ctx) => ({ restaurantId: ctx.restaurantId }) });

async function seed(sub: { status: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED'; end: Date } | null) {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  const account = await createClAccount(prisma(), { name: 'Dr Sara', email: 'sara@example.com', password: 'correct horse battery staple' });
  await prisma().clMember.create({ data: { accountId: account.id, restaurantId: 'clinic-a', role: 'OWNER' } });
  if (sub) {
    await prisma().application.upsert({ where: { id: 'clinic' }, create: { id: 'clinic', name: { en: 'Clinics' } }, update: {} });
    await prisma().subscription.create({
      data: {
        restaurantId: 'clinic-a',
        applicationId: 'clinic',
        planCode: 'STANDARD',
        status: sub.status,
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 50000,
        trialEndsAt: sub.status === 'TRIAL' ? sub.end : null,
        currentPeriodStart: new Date(sub.end.getTime() - 30 * DAY),
        currentPeriodEnd: sub.end,
        graceDays: 7,
        version: 1,
      },
    });
  }
  return account;
}

const sessionOf = (accountId: string) => ({ sessionId: 's', accountId, name: 'Sara', email: 'sara@example.com', space: 'CLINIC' as const });

describe('the plan gates the clinic', () => {
  beforeEach(() => void 0);

  it('keeps a clinic that never had a plan running', async () => {
    const account = await seed(null);
    const [member] = await loadClMemberships(prisma(), account.id, 'CLINIC', NOW);
    expect(member?.planEnded).toBe(false);
    expect(await runClAction(prisma(), sessionOf(account.id), whoAmI, {}, {}, {}, NOW)).toMatchObject({ ok: true });
  });

  it('runs on a paid plan and through its grace days', async () => {
    const paid = await seed({ status: 'ACTIVE', end: new Date(NOW.getTime() + 5 * DAY) });
    expect((await loadClMemberships(prisma(), paid.id, 'CLINIC', NOW))[0]?.planEnded).toBe(false);
    const grace = await seed({ status: 'ACTIVE', end: new Date(NOW.getTime() - 3 * DAY) });
    expect((await loadClMemberships(prisma(), grace.id, 'CLINIC', NOW))[0]?.planEnded).toBe(false);
  });

  it('closes a clinic whose plan and grace days have ended', async () => {
    const account = await seed({ status: 'ACTIVE', end: new Date(NOW.getTime() - 8 * DAY) });
    const memberships = await loadClMemberships(prisma(), account.id, 'CLINIC', NOW);
    expect(memberships[0]?.planEnded).toBe(true);
    expect(clEntry({ session: sessionOf(account.id), memberships, chosen: null })).toMatchObject({ kind: 'closed', reason: 'unpaid' });
    expect(await runClAction(prisma(), sessionOf(account.id), whoAmI, {}, {}, {}, NOW)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('closes a cancelled or expired plan, and opens again when a new one is bought', async () => {
    const account = await seed({ status: 'CANCELLED', end: new Date(NOW.getTime() - 40 * DAY) });
    expect((await loadClMemberships(prisma(), account.id, 'CLINIC', NOW))[0]?.planEnded).toBe(true);
    await prisma().subscription.create({
      data: { restaurantId: 'clinic-a', applicationId: 'clinic', planCode: 'STANDARD', status: 'ACTIVE', period: 'MONTHLY', currency: 'IQD', priceMinor: 50000, currentPeriodStart: NOW, currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY), graceDays: 7, version: 1 },
    });
    expect((await loadClMemberships(prisma(), account.id, 'CLINIC', NOW))[0]?.planEnded).toBe(false);
  });
});
