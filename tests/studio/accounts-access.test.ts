import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addAccountEntry,
  addAccountPayment,
  archiveAccountClient,
  archiveAccountEntry,
  archiveAccountPayment,
  createAccountClient,
  setAccountAccountant,
  setAccountRate,
  takeAccountBackup,
} from '@/server/studio/actions/accounts';
import { accountsAccountants, accountsBackup, accountsBackups, accountsBook, accountsLog } from '@/server/studio/queries/accounts';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let admin: Person;
let accountant: Person;
let stranger: Person;

beforeAll(() => useTestDatabase());
beforeEach(async () => {
  await resetWorld();
  const r = await restaurant('Access A');
  admin = await person('admin', { superAdmin: true });
  accountant = await person('accountant', { staff: [r.id, 'CASHIER'] });
  stranger = await person('stranger', { staff: [r.id, 'CASHIER'] });
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-10T12:00:00Z') });
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const emailOf = async (who: Person) => (await prisma().user.findUniqueOrThrow({ where: { id: who.userId }, select: { email: true } })).email;
const grant = async (who: Person) => dataOf(await run(admin, setAccountAccountant, { email: await emailOf(who), on: true }));

describe('the accountant', () => {
  it('has nothing until a Super Admin gives access, then reads the books and enters movements', async () => {
    expect(codeOf(await ask(accountant, accountsBook, {}))).toBe('FORBIDDEN');
    await grant(accountant);
    expect(dataOf(await ask(accountant, accountsBook, {})).movements).toEqual([]);

    const client = dataOf(await run(accountant, createAccountClient, { name: 'Al Nour' })).id as string;
    const entry = dataOf(await run(accountant, addAccountEntry, { kind: 'INCOME', clientId: client, service: 'Website', amount: '1,000', currency: 'USD', owed: true })).id as string;
    dataOf(await run(accountant, addAccountPayment, { entryId: entry, amount: '100' }));
    expect(dataOf(await ask(accountant, accountsBook, {})).movements[0]!.paidMinor).toBe(10_000);
  });

  it('can never delete, archive or change a setting, and cannot read the log, backups or hand out access', async () => {
    await grant(accountant);
    const client = dataOf(await run(admin, createAccountClient, { name: 'Al Nour' })).id as string;
    const entry = dataOf(await run(admin, addAccountEntry, { kind: 'INCOME', clientId: client, service: 'Website', amount: '1,000', currency: 'USD', owed: true })).id as string;
    const payment = dataOf(await run(admin, addAccountPayment, { entryId: entry, amount: '100' })).id as string;

    for (const result of [
      await run(accountant, archiveAccountEntry, { id: entry }),
      await run(accountant, archiveAccountPayment, { id: payment }),
      await run(accountant, archiveAccountClient, { id: client }),
      await run(accountant, setAccountRate, { rate: '1500' }),
      await run(accountant, takeAccountBackup, {}),
      await run(accountant, setAccountAccountant, { email: await emailOf(stranger), on: true }),
    ]) {
      expect(codeOf(result)).toBe('FORBIDDEN');
    }
    for (const result of [await ask(accountant, accountsLog, {}), await ask(accountant, accountsBackups, {}), await ask(accountant, accountsAccountants, {})]) {
      expect(codeOf(result)).toBe('FORBIDDEN');
    }
    expect(await prisma().accountEntry.count({ where: { archivedAt: null } })).toBe(1);
  });

  it('loses everything again when access is taken away, and a Super Admin cannot be listed as one', async () => {
    await grant(accountant);
    expect(dataOf(await ask(admin, accountsAccountants, {})).map((row) => row.name)).toHaveLength(1);
    dataOf(await run(admin, setAccountAccountant, { email: await emailOf(accountant), on: false }));
    expect(codeOf(await ask(accountant, accountsBook, {}))).toBe('FORBIDDEN');
    expect(dataOf(await ask(admin, accountsAccountants, {}))).toEqual([]);

    expect(codeOf(await run(admin, setAccountAccountant, { email: await emailOf(admin), on: true }))).toBe('INVALID');
    expect(codeOf(await run(admin, setAccountAccountant, { email: 'nobody@example.com', on: true }))).toBe('INVALID');
  });
});

describe('the daily backup', () => {
  it('is taken once a day, holds the book as it was, and the old ones are dropped', async () => {
    const client = dataOf(await run(admin, createAccountClient, { name: 'Al Nour' })).id as string;
    dataOf(await run(admin, addAccountEntry, { kind: 'INCOME', clientId: client, service: 'Website', amount: '1,000', currency: 'USD' }));

    expect(dataOf(await run(admin, takeAccountBackup, {})).taken).toBe(true);
    expect(dataOf(await run(admin, takeAccountBackup, {})).taken).toBe(false);
    dataOf(await run(admin, addAccountEntry, { kind: 'EXPENSE', service: 'Rent', amount: '5,000', currency: 'IQD' }));

    const [today] = dataOf(await ask(admin, accountsBackups, {}));
    expect(today).toMatchObject({ takenOn: '2026-11-10', entries: 1 });
    const kept = dataOf(await ask(admin, accountsBackup, { id: today!.id }));
    expect(kept.book.movements).toHaveLength(1);
    expect(kept.book.clients.map((row) => row.name)).toEqual(['Al Nour']);

    await prisma().accountBackup.create({ data: { takenOn: new Date('2026-09-01T00:00:00Z'), entries: 0, book: {} } });
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
    expect(dataOf(await run(admin, takeAccountBackup, {})).taken).toBe(true);
    expect(dataOf(await ask(admin, accountsBackups, {})).map((row) => row.takenOn)).toEqual(['2026-11-11', '2026-11-10']);
  });
});

describe('the change log', () => {
  it('shows who changed the books, newest first, with no amounts and nothing from outside the books', async () => {
    const client = dataOf(await run(admin, createAccountClient, { name: 'Al Nour' })).id as string;
    dataOf(await run(admin, addAccountEntry, { kind: 'INCOME', clientId: client, service: 'Website', amount: '1,000', currency: 'USD' }));
    const log = dataOf(await ask(admin, accountsLog, {}));
    expect(log.map((row) => row.action)).toEqual(['account.entry.created', 'account.client.created']);
    expect(log[0]).toMatchObject({ actorName: expect.any(String), entityType: 'AccountEntry' });
    expect(JSON.stringify(log)).not.toContain('1000');
  });
});
