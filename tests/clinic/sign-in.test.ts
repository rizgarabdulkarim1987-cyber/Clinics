import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { createClAccount, readClSession, signInClinic, signOutClinic, CL_LOCK_AFTER } from '@/server/clinic/auth/sign-in';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Clinic sign-in: its own accounts and sessions, a wrong password is one answer, five wrong ones lock the account. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
const NOW = new Date('2026-11-17T10:00:00Z');

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await createClAccount(prisma(), { name: 'Dr Sara', email: ' Sara@Example.com ', password: PASSWORD });
});

describe('creating an account', () => {
  it('stores the email lower case and trimmed, and never the password', async () => {
    const row = await prisma().clAccount.findUniqueOrThrow({ where: { email: 'sara@example.com' } });
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(row.passwordHash.length).toBeGreaterThan(20);
  });

  it('refuses a short password and a second account with the same email', async () => {
    await expect(createClAccount(prisma(), { name: 'X', email: 'x@example.com', password: 'short' })).rejects.toThrow();
    await expect(createClAccount(prisma(), { name: 'Sara 2', email: 'SARA@example.com', password: PASSWORD })).rejects.toThrow();
  });
});

describe('signing in', () => {
  it('opens a session for the right password, whatever the case of the email', async () => {
    const result = await signInClinic(prisma(), { email: 'SARA@example.com', password: PASSWORD, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = await readClSession(prisma(), result.token, NOW);
    expect(session).toMatchObject({ email: 'sara@example.com', name: 'Dr Sara' });
  });

  it('stores only a hash of the session token', async () => {
    const result = await signInClinic(prisma(), { email: 'sara@example.com', password: PASSWORD, now: NOW });
    if (!result.ok) throw new Error('expected sign-in');
    const rows = await prisma().clSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(result.token);
  });

  it('answers the same for a wrong password and for an email that has no account', async () => {
    const wrong = await signInClinic(prisma(), { email: 'sara@example.com', password: 'not the password at all', now: NOW });
    const unknown = await signInClinic(prisma(), { email: 'nobody@example.com', password: PASSWORD, now: NOW });
    expect(wrong).toEqual({ ok: false, reason: 'invalid' });
    expect(unknown).toEqual({ ok: false, reason: 'invalid' });
  });

  it('locks the account after five wrong passwords, even for the right one, until the lock ends', async () => {
    for (let i = 0; i < CL_LOCK_AFTER; i += 1) await signInClinic(prisma(), { email: 'sara@example.com', password: 'wrong wrong wrong', now: NOW });
    expect(await signInClinic(prisma(), { email: 'sara@example.com', password: PASSWORD, now: NOW })).toEqual({ ok: false, reason: 'locked' });
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect((await signInClinic(prisma(), { email: 'sara@example.com', password: PASSWORD, now: later })).ok).toBe(true);
  });

  it('clears the failure count after a good sign-in', async () => {
    await signInClinic(prisma(), { email: 'sara@example.com', password: 'wrong wrong wrong', now: NOW });
    await signInClinic(prisma(), { email: 'sara@example.com', password: PASSWORD, now: NOW });
    expect((await prisma().clAccount.findUniqueOrThrow({ where: { email: 'sara@example.com' } })).failedSignIns).toBe(0);
  });

  it('refuses a disabled account with the same answer as a wrong password', async () => {
    await prisma().clAccount.update({ where: { email: 'sara@example.com' }, data: { status: 'DISABLED' } });
    expect(await signInClinic(prisma(), { email: 'sara@example.com', password: PASSWORD, now: NOW })).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('the session', () => {
  it('is not valid after it expires, and a Studio-style or random token is nothing', async () => {
    const result = await signInClinic(prisma(), { email: 'sara@example.com', password: PASSWORD, now: NOW });
    if (!result.ok) throw new Error('expected sign-in');
    expect(await readClSession(prisma(), result.token, new Date(result.expiresAt.getTime() + 1))).toBeNull();
    expect(await readClSession(prisma(), 'a-studio-session-token', NOW)).toBeNull();
    expect(await readClSession(prisma(), '', NOW)).toBeNull();
  });

  it('ends on sign-out and is refused for a disabled account', async () => {
    const result = await signInClinic(prisma(), { email: 'sara@example.com', password: PASSWORD, now: NOW });
    if (!result.ok) throw new Error('expected sign-in');
    await prisma().clAccount.update({ where: { email: 'sara@example.com' }, data: { status: 'DISABLED' } });
    expect(await readClSession(prisma(), result.token, NOW)).toBeNull();
    await prisma().clAccount.update({ where: { email: 'sara@example.com' }, data: { status: 'ACTIVE' } });
    expect(await readClSession(prisma(), result.token, NOW)).not.toBeNull();
    await signOutClinic(prisma(), result.token);
    expect(await readClSession(prisma(), result.token, NOW)).toBeNull();
  });
});
