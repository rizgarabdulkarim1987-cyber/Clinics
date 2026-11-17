import { z } from 'zod';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as board from '@/server/clinic/actions/board';
import { createClAccount, readClSession, signInClinic } from '@/server/clinic/auth/sign-in';
import { defineClAction, loadClMemberships, runClAction } from '@/server/clinic/framework';
import { acceptClInvitation, createClInvitation, inspectClInvitation } from '@/server/clinic/invitations';
import { navFor } from '@/server/clinic/roles';
import { spaceBase, spaceOfPath } from '@/server/clinic/space';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** A beauty centre runs on the clinic engine, but its logins, businesses and links are its own. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
const NOW = new Date('2026-11-17T10:00:00Z');

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().restaurant.create({ data: { id: 'glow', name: 'Glow Beauty', type: 'OTHER', sector: 'CLINIC', clSettings: { create: { kind: 'BEAUTY' } } } });
});

const whoAmI = defineClAction({ name: 'test.who', roles: ['OWNER'], input: z.object({}), run: async (ctx) => ({ restaurantId: ctx.restaurantId }) });

describe('the two spaces', () => {
  it('tells a beauty path from a clinic one', () => {
    expect(spaceOfPath('/beauty')).toBe('BEAUTY');
    expect(spaceOfPath('/beauty/board')).toBe('BEAUTY');
    expect(spaceOfPath('/beautyful')).toBe('CLINIC');
    expect(spaceOfPath('/clinic/board')).toBe('CLINIC');
    expect(spaceOfPath(null)).toBe('CLINIC');
    expect(spaceBase('BEAUTY')).toBe('/beauty');
  });

  it('builds the menu under the product’s own prefix', () => {
    expect(navFor('OWNER', '/beauty')[1]?.href).toBe('/beauty/board');
    expect(navFor('OWNER')[1]?.href).toBe('/clinic/board');
  });
});

describe('separate logins', () => {
  it('lets one address hold a clinic account and a beauty account that never meet', async () => {
    await createClAccount(prisma(), { name: 'Sara', email: 'sara@example.com', password: PASSWORD });
    await createClAccount(prisma(), { name: 'Sara', email: 'sara@example.com', password: PASSWORD, space: 'BEAUTY' });
    await expect(createClAccount(prisma(), { name: 'Sara', email: 'sara@example.com', password: PASSWORD, space: 'BEAUTY' })).rejects.toThrow();
  });

  it('refuses a beauty login on the clinic sign-in, and the other way round', async () => {
    await createClAccount(prisma(), { name: 'Lina', email: 'lina@example.com', password: PASSWORD, space: 'BEAUTY' });
    expect(await signInClinic(prisma(), { email: 'lina@example.com', password: PASSWORD, now: NOW })).toEqual({ ok: false, reason: 'invalid' });
    const own = await signInClinic(prisma(), { email: 'lina@example.com', password: PASSWORD, space: 'BEAUTY', now: NOW });
    if (!own.ok) throw new Error('expected a beauty sign-in');
    expect((await readClSession(prisma(), own.token, NOW))?.space).toBe('BEAUTY');
  });

  it('shows an account only the businesses of its own space', async () => {
    const beauty = await createClAccount(prisma(), { name: 'Lina', email: 'lina@example.com', password: PASSWORD, space: 'BEAUTY' });
    const clinic = await createClAccount(prisma(), { name: 'Dr Sara', email: 'sara@example.com', password: PASSWORD });
    for (const accountId of [beauty.id, clinic.id]) {
      await prisma().clMember.create({ data: { accountId, restaurantId: 'glow', role: 'OWNER' } });
      await prisma().clMember.create({ data: { accountId, restaurantId: 'clinic-a', role: 'OWNER' } });
    }
    expect((await loadClMemberships(prisma(), beauty.id, 'BEAUTY')).map((m) => m.restaurantId)).toEqual(['glow']);
    expect((await loadClMemberships(prisma(), clinic.id)).map((m) => m.restaurantId)).toEqual(['clinic-a']);
  });

  it('runs an action only in a business of the session’s own space', async () => {
    const clinic = await createClAccount(prisma(), { name: 'Dr Sara', email: 'sara@example.com', password: PASSWORD });
    await prisma().clMember.create({ data: { accountId: clinic.id, restaurantId: 'glow', role: 'OWNER' } });
    const session = { sessionId: 's', accountId: clinic.id, name: 'Sara', email: 'sara@example.com', space: 'CLINIC' as const };
    // A clinic-space session cannot reach a beauty centre, even by a membership row that points at it.
    expect(await runClAction(prisma(), session, whoAmI, {}, { restaurantId: 'glow' })).toMatchObject({ ok: false });
  });
});

describe('the engine inside a beauty centre', () => {
  async function appointment() {
    const account = await createClAccount(prisma(), { name: 'Lina', email: 'lina@example.com', password: PASSWORD, space: 'BEAUTY' });
    const member = await prisma().clMember.create({ data: { accountId: account.id, restaurantId: 'glow', role: 'DOCTOR' } });
    const specialist = await prisma().clDoctor.create({ data: { restaurantId: 'glow', memberId: member.id } });
    const fee = await prisma().clDoctorFee.create({ data: { restaurantId: 'glow', doctorId: specialist.id, label: 'Facial', amount: 30000, sortOrder: 0 } });
    const household = await prisma().clHousehold.create({ data: { restaurantId: 'glow', phone: '07701234567' } });
    const client = await prisma().clPatient.create({ data: { restaurantId: 'glow', householdId: household.id, name: 'Client', phone: household.phone } });
    const ticket = await prisma().clTicket.create({ data: { restaurantId: 'glow', day: '2026-11-17', number: 1, patientId: client.id, doctorId: specialist.id, status: 'WITH_DOCTOR' } });
    const session = { sessionId: 's', accountId: account.id, name: 'Lina', email: 'lina@example.com', space: 'BEAUTY' as const };
    return { session, ticket, fee };
  }

  it('prices an appointment from the specialist’s price list and bills it', async () => {
    const { session, ticket, fee } = await appointment();
    const result = await runClAction(prisma(), session, board.endVisit, { ticketId: ticket.id, feeIds: [fee.id] });
    expect(result.ok).toBe(true);
    const bill = await prisma().clBill.findFirstOrThrow({ where: { ticketId: ticket.id } });
    expect(bill.total).toBe(30000);
  });

  it('keeps no complaint or note in a beauty centre', async () => {
    const { session, ticket, fee } = await appointment();
    const result = await runClAction(prisma(), session, board.endVisit, { ticketId: ticket.id, feeIds: [fee.id], note: 'something clinical' });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await prisma().clVisit.count()).toBe(0);
  });
});

describe('inviting to a beauty centre', () => {
  it('sends the link to the beauty app and makes a beauty account', async () => {
    const { url } = await createClInvitation(prisma(), { email: 'Owner@Example.com', restaurantId: 'glow', role: 'OWNER', invitedById: 'platform-admin', now: NOW });
    expect(url).toContain('/beauty/invite/');
    const token = url.split('/').pop()!;
    expect(await inspectClInvitation(prisma(), token, NOW)).toMatchObject({ status: 'valid', accountExists: false });
    const accepted = await acceptClInvitation(prisma(), { token, name: 'Owner', password: PASSWORD, now: NOW });
    if (!accepted.ok) throw new Error('expected the invitation to be accepted');
    expect(accepted.space).toBe('BEAUTY');
    expect((await prisma().clAccount.findUniqueOrThrow({ where: { email_space: { email: 'owner@example.com', space: 'BEAUTY' } } })).space).toBe('BEAUTY');
    expect(await prisma().clAccount.count({ where: { email: 'owner@example.com', space: 'CLINIC' } })).toBe(0);
  });

  it('keeps sending a clinic invitation to the clinic app', async () => {
    const { url } = await createClInvitation(prisma(), { email: 'o@example.com', restaurantId: 'clinic-a', role: 'OWNER', invitedById: 'platform-admin', now: NOW });
    expect(url).toContain('/clinic/invite/');
  });
});
