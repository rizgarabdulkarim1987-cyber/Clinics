import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canSee, navFor, CL_SCREENS } from '@/server/clinic/roles';
import * as staff from '@/server/clinic/actions/staff';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Who sees which screen of the clinic app, and the owner's staff screen: invite, change a role, switch a person off. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, restaurantId: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId, role } });
  return { sessionId: 's', accountId: id, name: email, email, memberId: member.id };
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().restaurant.create({ data: { id: 'clinic-b', name: 'Bright Clinic', type: 'OTHER', sector: 'CLINIC' } });
});

describe('screens by role', () => {
  it('shows every role the home, and the owner alone the staff screen', () => {
    for (const role of ['OWNER', 'RECEPTION', 'DOCTOR', 'CASHIER'] as const) expect(canSee(role, 'home')).toBe(true);
    expect(canSee('OWNER', 'staff')).toBe(true);
    for (const role of ['RECEPTION', 'DOCTOR', 'CASHIER'] as const) expect(canSee(role, 'staff')).toBe(false);
  });

  it('builds the menu from the same table, so a hidden screen is also a refused one', () => {
    expect(navFor('OWNER').map((item) => item.screen)).toEqual(['home', 'board', 'bookings', 'patients', 'doctors', 'services', 'staff', 'cashier', 'reports']);
    expect(navFor('RECEPTION').map((item) => item.screen)).toEqual(['home', 'board', 'bookings', 'patients', 'doctors', 'cashier']);
    expect(navFor('CASHIER').map((item) => item.screen)).toEqual(['home', 'board', 'cashier']);
    expect(navFor('DOCTOR').map((item) => item.screen)).toEqual(['home', 'board']);
    for (const screen of CL_SCREENS) expect(typeof canSee('OWNER', screen)).toBe('boolean');
  });
});

describe('the staff list', () => {
  it('shows the clinic’s people and open invitations, and no other clinic’s', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    await person('doc@a.test', 'clinic-a', 'DOCTOR');
    await person('other@b.test', 'clinic-b', 'OWNER');
    await runClAction(prisma(), owner, staff.inviteStaff, { email: 'new@a.test', role: 'RECEPTION' });
    const result = await runClAction(prisma(), owner, staff.listStaff, {});
    if (!result.ok) throw new Error('expected the list');
    expect(result.data.members.map((m) => m.email).sort()).toEqual(['doc@a.test', 'owner@a.test']);
    expect(result.data.invitations.map((i) => [i.email, i.role])).toEqual([['new@a.test', 'RECEPTION']]);
  });

  it('is refused to every role but the owner', async () => {
    const doctor = await person('doc@a.test', 'clinic-a', 'DOCTOR');
    expect(code(await runClAction(prisma(), doctor, staff.listStaff, {}))).toBe('FORBIDDEN');
  });
});

describe('inviting', () => {
  it('returns the link once, for the owner to send, and audits the address and role but never the link', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const result = await runClAction(prisma(), owner, staff.inviteStaff, { email: 'New@A.test', role: 'DOCTOR' });
    if (!result.ok) throw new Error('expected an invitation');
    expect(result.data.url).toContain('/clinic/invite/');
    const rows = await prisma().auditLog.findMany({ where: { restaurantId: 'clinic-a', action: 'clinic.staff_invited' } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.changes)).not.toContain('/clinic/invite/');
    expect(JSON.stringify(rows[0]!.changes)).toContain('new@a.test');
  });

  it('does not invite another owner by this screen’s role list, and refuses a second pending invitation', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    expect(code(await runClAction(prisma(), owner, staff.inviteStaff, { email: 'x@a.test', role: 'OWNER' }))).toBe('INVALID');
    expect((await runClAction(prisma(), owner, staff.inviteStaff, { email: 'x@a.test', role: 'CASHIER' })).ok).toBe(true);
    expect(code(await runClAction(prisma(), owner, staff.inviteStaff, { email: 'x@a.test', role: 'CASHIER' }))).toBe('CONFLICT');
  });

  it('withdraws an open invitation, in this clinic only', async () => {
    const ownerA = await person('owner@a.test', 'clinic-a', 'OWNER');
    const ownerB = await person('owner@b.test', 'clinic-b', 'OWNER');
    await runClAction(prisma(), ownerA, staff.inviteStaff, { email: 'x@a.test', role: 'CASHIER' });
    const invitation = await prisma().clInvitation.findFirstOrThrow({ where: { restaurantId: 'clinic-a' } });
    expect(code(await runClAction(prisma(), ownerB, staff.revokeStaffInvitation, { invitationId: invitation.id }))).toBe('NOT_FOUND');
    expect((await runClAction(prisma(), ownerA, staff.revokeStaffInvitation, { invitationId: invitation.id })).ok).toBe(true);
    expect((await prisma().clInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).revokedAt).not.toBeNull();
  });
});

describe('changing a person', () => {
  it('changes a role and switches a person off and on, with an audit row each', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const doctor = await person('doc@a.test', 'clinic-a', 'DOCTOR');
    expect((await runClAction(prisma(), owner, staff.changeStaffRole, { memberId: doctor.memberId, role: 'RECEPTION' })).ok).toBe(true);
    expect((await prisma().clMember.findUniqueOrThrow({ where: { id: doctor.memberId } })).role).toBe('RECEPTION');
    expect((await runClAction(prisma(), owner, staff.setStaffActive, { memberId: doctor.memberId, active: false })).ok).toBe(true);
    expect((await prisma().clMember.findUniqueOrThrow({ where: { id: doctor.memberId } })).status).toBe('DISABLED');
    expect((await runClAction(prisma(), owner, staff.setStaffActive, { memberId: doctor.memberId, active: true })).ok).toBe(true);
    expect(await prisma().auditLog.count({ where: { restaurantId: 'clinic-a', action: { in: ['clinic.staff_role_changed', 'clinic.staff_status_changed'] } } })).toBe(3);
  });

  it('never touches a person of another clinic, and answers as for one that does not exist', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const stranger = await person('doc@b.test', 'clinic-b', 'DOCTOR');
    expect(code(await runClAction(prisma(), owner, staff.changeStaffRole, { memberId: stranger.memberId, role: 'CASHIER' }))).toBe('NOT_FOUND');
    expect(code(await runClAction(prisma(), owner, staff.setStaffActive, { memberId: stranger.memberId, active: false }))).toBe('NOT_FOUND');
    expect((await prisma().clMember.findUniqueOrThrow({ where: { id: stranger.memberId } })).role).toBe('DOCTOR');
  });

  it('leaves every owner’s place, their own and a co-owner’s, to the platform', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const second = await person('second@a.test', 'clinic-a', 'OWNER');
    expect(code(await runClAction(prisma(), owner, staff.changeStaffRole, { memberId: owner.memberId, role: 'DOCTOR' }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), owner, staff.setStaffActive, { memberId: owner.memberId, active: false }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), owner, staff.changeStaffRole, { memberId: second.memberId, role: 'DOCTOR' }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), owner, staff.setStaffActive, { memberId: second.memberId, active: false }))).toBe('FORBIDDEN');
    const kept = await prisma().clMember.findUniqueOrThrow({ where: { id: second.memberId } });
    expect([kept.role, kept.status]).toEqual(['OWNER', 'ACTIVE']);
  });
});
