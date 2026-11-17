import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction } from '../framework';
import { createClInvitation } from '../invitations';

/**
 * The owner's staff screen: who works in the clinic, who is invited, and the changes the owner may make. Other owners
 * are added by the platform, not here, and an owner never changes or switches off their own place, so a clinic cannot
 * be left without one.
 */

const STAFF_ROLES = ['RECEPTION', 'DOCTOR', 'CASHIER'] as const;
const roleField = z.enum(STAFF_ROLES);

export const listStaff = defineClAction({
  name: 'clinic.staff.list',
  roles: ['OWNER'],
  input: z.object({}),
  run: async (ctx) => {
    const [members, invitations] = await Promise.all([
      ctx.db.clMember.findMany({ include: { account: { select: { name: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
      ctx.db.clInvitation.findMany({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      members: members.map((m) => ({ memberId: m.id, name: m.account.name, email: m.account.email, role: m.role, status: m.status, isSelf: m.id === ctx.member.memberId })),
      invitations: invitations.map((i) => ({ invitationId: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt })),
    };
  },
});

export const inviteStaff = defineClAction({
  name: 'clinic.staff.invite',
  roles: ['OWNER'],
  input: z.object({ email: z.string().trim().email('Enter a valid email address').max(254), role: roleField }),
  run: async (ctx, { email, role }) => {
    // The link is returned once for the owner to send: the invitation mail's text only knows an owner, so no mail goes.
    const { invitationId, url } = await createClInvitation(ctx.db as unknown as PrismaClient, {
      email,
      restaurantId: ctx.restaurantId,
      role,
      invitedById: ctx.account.accountId,
      now: new Date(),
    });
    ctx.audit({ action: 'clinic.staff_invited', entityType: 'ClInvitation', entityId: invitationId, changes: { email: { before: null, after: email.trim().toLowerCase() }, role: { before: null, after: role } } });
    return { invitationId, url };
  },
});

export const revokeStaffInvitation = defineClAction({
  name: 'clinic.staff.revokeInvitation',
  roles: ['OWNER'],
  input: z.object({ invitationId: z.string().min(1).max(64) }),
  run: async (ctx, { invitationId }) => {
    const { count } = await ctx.db.clInvitation.updateMany({ where: { id: invitationId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) throw new StudioError('NOT_FOUND');
    ctx.audit({ action: 'clinic.invitation_revoked', entityType: 'ClInvitation', entityId: invitationId, changes: {} });
    return null;
  },
});

/** The member row of this clinic an id names, never one of another clinic, and never the caller's own. */
async function otherMember(ctx: { db: { clMember: { findFirst: (args: { where: { id: string } }) => Promise<{ id: string; role: string; status: string } | null> } }; member: { memberId: string } }, memberId: string) {
  const row = await ctx.db.clMember.findFirst({ where: { id: memberId } });
  if (!row) throw new StudioError('NOT_FOUND');
  if (row.id === ctx.member.memberId) throw new StudioError('FORBIDDEN', 'You cannot change your own place here');
  return row;
}

export const changeStaffRole = defineClAction({
  name: 'clinic.staff.changeRole',
  roles: ['OWNER'],
  input: z.object({ memberId: z.string().min(1).max(64), role: roleField }),
  run: async (ctx, { memberId, role }) => {
    const row = await otherMember(ctx, memberId);
    await ctx.db.clMember.update({ where: { id: memberId }, data: { role } });
    ctx.audit({ action: 'clinic.staff_role_changed', entityType: 'ClMember', entityId: memberId, changes: { role: { before: row.role, after: role } } });
    return null;
  },
});

export const setStaffActive = defineClAction({
  name: 'clinic.staff.setActive',
  roles: ['OWNER'],
  input: z.object({ memberId: z.string().min(1).max(64), active: z.boolean() }),
  run: async (ctx, { memberId, active }) => {
    const row = await otherMember(ctx, memberId);
    const status = active ? 'ACTIVE' : 'DISABLED';
    await ctx.db.clMember.update({ where: { id: memberId }, data: { status } });
    ctx.audit({ action: 'clinic.staff_status_changed', entityType: 'ClMember', entityId: memberId, changes: { status: { before: row.status, after: status } } });
    return null;
  },
});
