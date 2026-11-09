import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addAccountEntry, archiveAccountClient, archiveAccountEntry, createAccountClient } from '@/server/studio/actions/accounts';
import { accountsBook } from '@/server/studio/queries/accounts';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let admin: Person;
let owner: Person;
let cashier: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  const r = await restaurant('Accounts A');
  admin = await person('admin', { superAdmin: true });
  owner = await person('owner', { membership: [r.id, 'OWNER'] });
  cashier = await person('cashier', { staff: [r.id, 'CASHIER'] });
});

afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

const newClient = async (name: string, extra: Record<string, unknown> = {}) => dataOf(await run(admin, createAccountClient, { name, ...extra }));

describe('who may keep the books', () => {
  it('refuses an owner and a cashier everywhere', async () => {
    for (const who of [owner, cashier]) {
      expect(codeOf(await run(who, createAccountClient, { name: 'X' }))).toBe('FORBIDDEN');
      expect(codeOf(await run(who, addAccountEntry, { kind: 'INCOME', amount: '1000', currency: 'IQD' }))).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, accountsBook, {}))).toBe('FORBIDDEN');
    }
    expect(await prisma().accountClient.count()).toBe(0);
  });
});

describe('clients', () => {
  it('makes the slug from the name', async () => {
    const created = await newClient('مطعم الرافدين', { phone: '0770 000 0000' });
    expect(created.slug).toBe('mtam-alrafdyn');
    const row = await prisma().accountClient.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ name: 'مطعم الرافدين', slug: 'mtam-alrafdyn', phone: '0770 000 0000' });
  });

  it('uses the slug the person edited, cleaned', async () => {
    expect((await newClient('Cafe Zahra', { slug: 'Zahra Cafe!' })).slug).toBe('zahra-cafe');
  });

  it('adds -2 and -3 to a slug that is taken, even by an archived client', async () => {
    const first = await newClient('Al Nour');
    expect((await newClient('Al Nour')).slug).toBe('al-nour-2');
    dataOf(await run(admin, archiveAccountClient, { id: first.id }));
    expect((await newClient('Al Nour')).slug).toBe('al-nour-3');
  });

  it('needs a name', async () => {
    expect(failureOf(await run(admin, createAccountClient, { name: '   ' })).code).toBe('INVALID');
    expect(await prisma().accountClient.count()).toBe(0);
  });

  it('is audited', async () => {
    await newClient('Audit Me');
    expect(await prisma().auditLog.count({ where: { action: 'account.client.created' } })).toBe(1);
  });
});

describe('movements', () => {
  it('stores dinars as whole dinars and dollars as cents, on the day given', async () => {
    const client = await newClient('Al Nour');
    dataOf(await run(admin, addAccountEntry, { kind: 'INCOME', amount: '1,500,000', currency: 'IQD', clientId: client.id, service: 'website', occurredOn: '2026-11-05' }));
    dataOf(await run(admin, addAccountEntry, { kind: 'EXPENSE', amount: '19.99', currency: 'USD', service: 'subscription', occurredOn: '2026-11-06' }));
    const rows = await prisma().accountEntry.findMany({ orderBy: { occurredOn: 'asc' } });
    expect(rows.map((row) => [row.kind, row.amountMinor, row.currency, row.clientId, row.occurredOn.toISOString().slice(0, 10)])).toEqual([
      ['INCOME', 1_500_000, 'IQD', client.id, '2026-11-05'],
      ['EXPENSE', 1999, 'USD', null, '2026-11-06'],
    ]);
  });

  it('defaults to today when no day is given', async () => {
    dataOf(await run(admin, addAccountEntry, { kind: 'INCOME', amount: '1000', currency: 'IQD' }));
    const row = await prisma().accountEntry.findFirstOrThrow();
    expect(Math.abs(row.occurredOn.getTime() - Date.now())).toBeLessThan(2 * 86_400_000);
  });

  it('refuses an amount that is not a number, is zero, or has cents in dinars', async () => {
    for (const [amount, currency] of [['abc', 'IQD'], ['0', 'IQD'], ['0.00', 'USD'], ['25.5', 'IQD'], ['', 'USD']] as const) {
      const error = failureOf(await run(admin, addAccountEntry, { kind: 'INCOME', amount, currency }));
      expect(error.code, `${amount} ${currency}`).toBe('INVALID');
      expect(error.fields?.amount, `${amount} ${currency}`).toBeTruthy();
    }
    expect(await prisma().accountEntry.count()).toBe(0);
  });

  it('refuses a day that is not a calendar day, and an unknown, archived or missing client', async () => {
    const base = { kind: 'INCOME', amount: '1000', currency: 'IQD' };
    expect(codeOf(await run(admin, addAccountEntry, { ...base, occurredOn: '2026-13-40' }))).toBe('INVALID');
    expect(codeOf(await run(admin, addAccountEntry, { ...base, clientId: 'nope' }))).toBe('NOT_FOUND');
    const client = await newClient('Gone');
    dataOf(await run(admin, archiveAccountClient, { id: client.id }));
    expect(codeOf(await run(admin, addAccountEntry, { ...base, clientId: client.id }))).toBe('NOT_FOUND');
  });

  it('archives a movement instead of deleting it, and the books stop counting it', async () => {
    const { id } = dataOf(await run(admin, addAccountEntry, { kind: 'INCOME', amount: '5000', currency: 'IQD' }));
    dataOf(await run(admin, archiveAccountEntry, { id }));
    expect(await prisma().accountEntry.count()).toBe(1);
    expect(dataOf(await ask(admin, accountsBook, {})).movements).toHaveLength(0);
    expect(codeOf(await run(admin, archiveAccountEntry, { id: 'nope' }))).toBe('NOT_FOUND');
  });
});

describe('the book the screen reads', () => {
  it('lists the active clients and the movements, newest day first, with client names', async () => {
    const client = await newClient('Al Nour');
    const gone = await newClient('Old Client');
    dataOf(await run(admin, addAccountEntry, { kind: 'INCOME', amount: '100', currency: 'IQD', clientId: client.id, occurredOn: '2026-10-01' }));
    dataOf(await run(admin, addAccountEntry, { kind: 'EXPENSE', amount: '50', currency: 'IQD', occurredOn: '2026-11-01' }));
    dataOf(await run(admin, archiveAccountClient, { id: gone.id }));
    const book = dataOf(await ask(admin, accountsBook, {}));
    expect(book.clients.map((c) => c.name)).toEqual(['Al Nour']);
    expect(book.movements.map((m) => [m.occurredOn, m.clientName])).toEqual([
      ['2026-11-01', null],
      ['2026-10-01', 'Al Nour'],
    ]);
  });

  it('keeps an archived client\'s name on its past movements', async () => {
    const client = await newClient('Old Client');
    dataOf(await run(admin, addAccountEntry, { kind: 'INCOME', amount: '100', currency: 'IQD', clientId: client.id }));
    dataOf(await run(admin, archiveAccountClient, { id: client.id }));
    const book = dataOf(await ask(admin, accountsBook, {}));
    expect(book.clients).toHaveLength(0);
    expect(book.movements[0]!.clientName).toBe('Old Client');
  });
});
