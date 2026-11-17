import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { createClAccount, readClSession } from '@/server/clinic/auth/sign-in';
import { acceptClInvitation, createClInvitation, inspectClInvitation, CL_INVITATION_DAYS } from '@/server/clinic/invitations';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** A clinic invitation is accepted on the clinic app's page: it makes a clinic account and a membership, never a Studio user. */

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
  await prisma().restaurant.create({ data: { id: 'clinic-b', name: 'Bright Clinic', type: 'OTHER', sector: 'CLINIC' } });
});

const invite = (email: string, restaurantId = 'clinic-a', role: 'OWNER' | 'DOCTOR' = 'OWNER') =>
  createClInvitation(prisma(), { email, restaurantId, role, invitedById: 'platform-admin', now: NOW });

const tokenOf = (url: string) => url.split('/').pop()!;

describe('inviting', () => {
  it('returns a link on the clinic app and stores only a hash of its token', async () => {
    const { url, invitationId } = await invite(' Owner@Example.com ');
    expect(url).toContain('/clinic/invite/');
    const row = await prisma().clInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(row.email).toBe('owner@example.com');
    expect(row.tokenHash).not.toContain(tokenOf(url));
    expect(row.expiresAt.getTime()).toBe(NOW.getTime() + CL_INVITATION_DAYS * 86_400_000);
  });

  it('refuses a second pending invitation to the same address for the same clinic', async () => {
    await invite('owner@example.com');
    await expect(invite('owner@example.com')).rejects.toThrow();
    await expect(invite('owner@example.com', 'clinic-b')).resolves.toBeTruthy();
  });

  it('refuses a clinic that is not a clinic', async () => {
    await prisma().restaurant.create({ data: { id: 'shop', name: 'Shop', type: 'OTHER', sector: 'RETAIL' } });
    await expect(invite('owner@example.com', 'shop')).rejects.toThrow();
  });
});

describe('looking at an invitation', () => {
  it('shows the address, clinic and role of a valid one, and only the status of any other', async () => {
    const { url } = await invite('owner@example.com');
    expect(await inspectClInvitation(prisma(), tokenOf(url), NOW)).toEqual({ status: 'valid', email: 'owner@example.com', clinicName: 'Smile Clinic', role: 'OWNER', accountExists: false });
    expect(await inspectClInvitation(prisma(), 'nonsense', NOW)).toEqual({ status: 'unknown' });
    const later = new Date(NOW.getTime() + (CL_INVITATION_DAYS + 1) * 86_400_000);
    expect(await inspectClInvitation(prisma(), tokenOf(url), later)).toEqual({ status: 'expired' });
  });
});

describe('accepting', () => {
  it('makes the account, the owner membership and a session, and uses the invitation up', async () => {
    const { url } = await invite('owner@example.com');
    const result = await acceptClInvitation(prisma(), { token: tokenOf(url), name: 'Dr Owner', password: PASSWORD, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.restaurantId).toBe('clinic-a');
    expect(await readClSession(prisma(), result.sessionToken, NOW)).toMatchObject({ email: 'owner@example.com', name: 'Dr Owner' });
    const member = await prisma().clMember.findFirstOrThrow({ where: { restaurantId: 'clinic-a' } });
    expect(member).toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
    expect(await prisma().user.count()).toBe(0);
    expect(await acceptClInvitation(prisma(), { token: tokenOf(url), name: 'Dr Owner', password: PASSWORD, now: NOW })).toEqual({ ok: false, reason: 'used' });
  });

  it('adds a membership to an existing account only with its own password', async () => {
    await createClAccount(prisma(), { name: 'Dr Sara', email: 'sara@example.com', password: PASSWORD });
    const { url } = await invite('sara@example.com', 'clinic-b', 'DOCTOR');
    expect(await acceptClInvitation(prisma(), { token: tokenOf(url), name: 'x', password: 'wrong wrong wrong', now: NOW })).toEqual({ ok: false, reason: 'password' });
    expect(await prisma().clMember.count()).toBe(0);
    expect((await acceptClInvitation(prisma(), { token: tokenOf(url), name: 'x', password: PASSWORD, now: NOW })).ok).toBe(true);
    expect(await prisma().clAccount.count()).toBe(1);
    expect((await prisma().clMember.findFirstOrThrow()).role).toBe('DOCTOR');
  });

  it('refuses a weak password for a new account and keeps the invitation open', async () => {
    const { url } = await invite('owner@example.com');
    expect(await acceptClInvitation(prisma(), { token: tokenOf(url), name: 'Dr Owner', password: 'short', now: NOW })).toEqual({ ok: false, reason: 'weak' });
    expect((await inspectClInvitation(prisma(), tokenOf(url), NOW)).status).toBe('valid');
  });

  it('refuses an expired, a withdrawn and an unknown token', async () => {
    const first = await invite('owner@example.com');
    const later = new Date(NOW.getTime() + (CL_INVITATION_DAYS + 1) * 86_400_000);
    expect(await acceptClInvitation(prisma(), { token: tokenOf(first.url), name: 'x', password: PASSWORD, now: later })).toEqual({ ok: false, reason: 'expired' });
    const second = await invite('other@example.com', 'clinic-b');
    await prisma().clInvitation.update({ where: { id: second.invitationId }, data: { revokedAt: NOW } });
    expect(await acceptClInvitation(prisma(), { token: tokenOf(second.url), name: 'x', password: PASSWORD, now: NOW })).toEqual({ ok: false, reason: 'revoked' });
    expect(await acceptClInvitation(prisma(), { token: 'nonsense', name: 'x', password: PASSWORD, now: NOW })).toEqual({ ok: false, reason: 'unknown' });
  });
});
