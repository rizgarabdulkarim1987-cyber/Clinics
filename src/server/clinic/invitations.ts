import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import { authEnv } from '@/server/env';
import { sendAfterResponse } from '@/server/studio/auth/auth';
import { checkPasswordPolicy } from '@/server/studio/auth/password-policy';
import { StudioError } from '@/server/studio/framework/result';
import { checkClPassword, CL_SESSION_DAYS, normalizeClEmail } from './auth/sign-in';

/**
 * Invitations to work in a clinic. Clinics' own (`ClInvitation`): accepted on the clinic app's page, an invitation makes
 * a clinic account and a membership and never touches a Studio user, so a person's Studio, Pharmacy or Menu account is
 * neither needed nor looked at.
 */

export const CL_INVITATION_DAYS = 7;

type ClRole = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** The clinic app's own origin; its address is the only thing that tells a clinic link from a Studio one. */
function clinicBaseUrl(): string {
  return authEnv().baseUrl;
}

/** A plain client, or the transaction of the action that makes the clinic. */
type InviteDb = PrismaClient | ScopedTx;

/**
 * Makes an invitation and returns the link for it. The link is not stored anywhere, so this is the only time it can be
 * shown; only a hash of its token is kept. One pending invitation per address and clinic.
 */
export function prepareClInvitation(args: { email: string; role: ClRole; invitedById: string; now: Date }): {
  data: { email: string; role: ClRole; tokenHash: string; expiresAt: Date; invitedById: string };
  url: string;
} {
  const token = randomBytes(32).toString('base64url');
  return {
    data: {
      email: normalizeClEmail(args.email),
      role: args.role,
      tokenHash: hashToken(token),
      expiresAt: new Date(args.now.getTime() + CL_INVITATION_DAYS * 86_400_000),
      invitedById: args.invitedById,
    },
    url: `${clinicBaseUrl()}/clinic/invite/${token}`,
  };
}

/** The mail that carries an owner's link, queued for after the commit. */
export function queueClOwnerMail(
  args: { email: string; url: string; clinicName: string; inviterName: string; locale: string },
  afterCommit: ((fn: () => void) => void) | undefined,
): void {
  const send = () => sendAfterResponse({ email: args.email, name: '', locale: args.locale }, 'invite', { url: args.url, inviter: args.inviterName, restaurant: args.clinicName, role: 'OWNER' });
  (afterCommit ?? ((fn) => fn()))(send);
}

export async function createClInvitation(
  database: InviteDb,
  args: { email: string; restaurantId: string; role: ClRole; invitedById: string; now: Date; mail?: { inviterName: string; locale: string } },
  options: { afterCommit?: (fn: () => void) => void } = {},
): Promise<{ invitationId: string; url: string }> {
  const db = database as PrismaClient;
  const clinic = await db.restaurant.findUnique({ where: { id: args.restaurantId }, select: { sector: true, name: true } });
  if (clinic?.sector !== 'CLINIC') throw new StudioError('NOT_FOUND', 'This clinic does not exist');
  const email = normalizeClEmail(args.email);
  const pending = await db.clInvitation.findFirst({
    where: { email, restaurantId: args.restaurantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: args.now } },
    select: { id: true },
  });
  if (pending) throw new StudioError('CONFLICT', 'This address already has a pending invitation. Resend it instead', { email: 'This address already has a pending invitation. Resend it instead' });
  const prepared = prepareClInvitation({ email, role: args.role, invitedById: args.invitedById, now: args.now });
  const created = await db.clInvitation.create({ data: { ...prepared.data, restaurantId: args.restaurantId }, select: { id: true } });
  const { url } = prepared;
  const { mail } = args;
  // The invitation mail's text knows an owner only; staff links are handed over by the clinic's owner for now.
  if (mail && args.role === 'OWNER') queueClOwnerMail({ email, url, clinicName: clinic.name, inviterName: mail.inviterName, locale: mail.locale }, options.afterCommit);
  return { invitationId: created.id, url };
}

export type ClInvitationStatus = 'valid' | 'expired' | 'used' | 'revoked' | 'unknown';

export interface ClInvitationView {
  status: ClInvitationStatus;
  email?: string;
  clinicName?: string;
  role?: ClRole;
  accountExists?: boolean;
}

function statusOf(row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): ClInvitationStatus {
  if (row.acceptedAt) return 'used';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

/** What the invitation page shows for a token: the status alone for one that cannot be used, the details for one that can. */
export async function inspectClInvitation(prisma: PrismaClient, token: string, now: Date): Promise<ClInvitationView> {
  const row = await prisma.clInvitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { restaurant: { select: { name: true } } } });
  if (!row) return { status: 'unknown' };
  const status = statusOf(row, now);
  if (status !== 'valid') return { status };
  const account = await prisma.clAccount.findUnique({ where: { email: row.email }, select: { id: true } });
  return { status, email: row.email, clinicName: row.restaurant.name, role: row.role, accountExists: account !== null };
}

export type ClAccept =
  | { ok: true; sessionToken: string; expiresAt: Date; restaurantId: string }
  | { ok: false; reason: 'expired' | 'used' | 'revoked' | 'unknown' | 'password' | 'weak' };

/**
 * Uses an invitation. A new address gets an account from `name` and `password`; an address that already has a clinic
 * account must give that account's password, so a link alone never adds a clinic to someone else's account. Everything
 * happens in one transaction: a refusal leaves the invitation open.
 */
export async function acceptClInvitation(prisma: PrismaClient, input: { token: string; name: string; password: string; now: Date }): Promise<ClAccept> {
  const row = await prisma.clInvitation.findUnique({ where: { tokenHash: hashToken(input.token) } });
  if (!row) return { ok: false, reason: 'unknown' };
  const status = statusOf(row, input.now);
  if (status !== 'valid') return { ok: false, reason: status as 'expired' | 'used' | 'revoked' | 'unknown' };

  const existing = await prisma.clAccount.findUnique({ where: { email: row.email } });
  if (existing) {
    // The sign-in's own check, lock included: an invitation link is no way round the lock on a password.
    if (existing.status !== 'ACTIVE' || (await checkClPassword(prisma, existing, input.password, input.now)) !== 'ok') return { ok: false, reason: 'password' };
  } else if (checkPasswordPolicy(input.password) !== null) {
    return { ok: false, reason: 'weak' };
  }
  const passwordHash = existing ? null : await hashPassword(input.password);

  const sessionToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(input.now.getTime() + CL_SESSION_DAYS * 86_400_000);
  const claimed = await prisma.$transaction(async (tx) => {
    // Only while it is still open: a use or a withdrawal that came in between wins.
    const { count } = await tx.clInvitation.updateMany({
      where: { id: row.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: input.now } },
      data: { acceptedAt: input.now },
    });
    if (count === 0) return false;
    if (existing) await tx.clAccount.update({ where: { id: existing.id }, data: { failedSignIns: 0, lockedUntil: null } });
    const accountId = existing
      ? existing.id
      : (await tx.clAccount.create({ data: { name: input.name.trim() || row.email, email: row.email, passwordHash: passwordHash! }, select: { id: true } })).id;
    await tx.clMember.upsert({
      where: { accountId_restaurantId: { accountId, restaurantId: row.restaurantId } },
      create: { accountId, restaurantId: row.restaurantId, role: row.role },
      update: { role: row.role, status: 'ACTIVE' },
    });
    await tx.clSession.create({ data: { accountId, tokenHash: hashToken(sessionToken), expiresAt } });
    return true;
  });
  if (!claimed) return { ok: false, reason: 'used' };
  return { ok: true, sessionToken, expiresAt, restaurantId: row.restaurantId };
}
