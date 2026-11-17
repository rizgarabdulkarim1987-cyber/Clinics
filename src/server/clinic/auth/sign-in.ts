import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { checkPasswordPolicy, PasswordPolicyError } from '@/server/studio/auth/password-policy';

/**
 * Clinic sign-in. Clinics keeps its own accounts and sessions (`ClAccount`, `ClSession`): nothing here reads a Studio
 * user, and a Studio, Pharmacy or Menu session is not a clinic session. The functions take the Prisma client and the
 * time so they can be tested; the cookie is set by `./cookie`.
 */

/** Wrong passwords in a row that lock the account. */
export const CL_LOCK_AFTER = 5;
/** How long a lock lasts. */
export const CL_LOCK_MINUTES = 15;
/** How long a session lasts. */
export const CL_SESSION_DAYS = 14;

const DAY = 86_400_000;

/** Lower case and trimmed: the one form of an email the tables hold. */
export const normalizeClEmail = (email: string): string => email.trim().toLowerCase();

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Checked against when no account matches, so an unknown email costs what a wrong password costs. */
let dummyHash: Promise<string> | undefined;
const dummy = (): Promise<string> => (dummyHash ??= hashPassword(randomUUID()));

/** Makes a clinic account. Throws `PasswordPolicyError` for a weak password; a duplicate email throws the database's error. */
export async function createClAccount(prisma: PrismaClient, input: { name: string; email: string; password: string }): Promise<{ id: string }> {
  const problem = checkPasswordPolicy(input.password);
  if (problem) throw new PasswordPolicyError(problem);
  return prisma.clAccount.create({
    data: { name: input.name.trim(), email: normalizeClEmail(input.email), passwordHash: await hashPassword(input.password) },
    select: { id: true },
  });
}

/**
 * The one password check for an existing clinic account, used by sign-in and by accepting an invitation, so neither is a
 * way round the lock. A locked account is refused whatever the password; a wrong password counts, and the fifth in a row
 * locks the account. The caller clears the counters in its own transaction once it has acted on `ok`.
 */
export async function checkClPassword(
  prisma: PrismaClient,
  account: { id: string; passwordHash: string; failedSignIns: number; lockedUntil: Date | null },
  password: string,
  now: Date,
): Promise<'ok' | 'invalid' | 'locked'> {
  // The same work whatever the answer, so the time taken does not tell a locked account from the rest.
  const matches = await verifyPassword({ hash: account.passwordHash, password });
  if (account.lockedUntil && account.lockedUntil > now) return 'locked';
  if (matches) return 'ok';
  const failures = (account.lockedUntil && account.lockedUntil <= now ? 0 : account.failedSignIns) + 1;
  const lock = failures >= CL_LOCK_AFTER;
  await prisma.clAccount.update({
    where: { id: account.id },
    data: { failedSignIns: lock ? 0 : failures, lockedUntil: lock ? new Date(now.getTime() + CL_LOCK_MINUTES * 60_000) : null },
  });
  return 'invalid';
}

export type ClSignIn = { ok: true; token: string; expiresAt: Date } | { ok: false; reason: 'invalid' | 'locked' };

/**
 * Checks an email and password and opens a session. A wrong password, an unknown email and a disabled account all
 * answer `invalid`; only an account that has been locked by failures answers `locked`.
 */
export async function signInClinic(prisma: PrismaClient, input: { email: string; password: string; now?: Date }): Promise<ClSignIn> {
  const now = input.now ?? new Date();
  const account = await prisma.clAccount.findUnique({ where: { email: normalizeClEmail(input.email) } });
  if (!account || account.status !== 'ACTIVE') {
    await verifyPassword({ hash: await dummy(), password: input.password });
    return { ok: false, reason: 'invalid' };
  }
  const verdict = await checkClPassword(prisma, account, input.password, now);
  if (verdict !== 'ok') return { ok: false, reason: verdict };
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + CL_SESSION_DAYS * DAY);
  await prisma.$transaction([
    prisma.clAccount.update({ where: { id: account.id }, data: { failedSignIns: 0, lockedUntil: null } }),
    prisma.clSession.create({ data: { accountId: account.id, tokenHash: tokenHash(token), expiresAt } }),
  ]);
  return { ok: true, token, expiresAt };
}

export interface ClSessionView {
  sessionId: string;
  accountId: string;
  name: string;
  email: string;
}

/** The person a session token belongs to, or null when it is unknown, expired, or its account is disabled. */
export async function readClSession(prisma: PrismaClient, token: string | undefined, now: Date = new Date()): Promise<ClSessionView | null> {
  if (!token) return null;
  const row = await prisma.clSession.findUnique({ where: { tokenHash: tokenHash(token) }, include: { account: true } });
  if (!row || row.expiresAt <= now || row.account.status !== 'ACTIVE') return null;
  return { sessionId: row.id, accountId: row.accountId, name: row.account.name, email: row.account.email };
}

/** Ends the session a token opened. Silent for a token that is not one. */
export async function signOutClinic(prisma: PrismaClient, token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.clSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
}
