import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addAccountRecurring, applyAccountRecurring, archiveAccountRecurring, removeAccountBudget, setAccountBudget } from '@/server/studio/actions/accounts';
import { accountsBook } from '@/server/studio/queries/accounts';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let admin: Person;
let cashier: Person;

beforeAll(() => useTestDatabase());
beforeEach(async () => {
  await resetWorld();
  const r = await restaurant('Recurring A');
  admin = await person('admin', { superAdmin: true });
  cashier = await person('cashier', { staff: [r.id, 'CASHIER'] });
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

/** Baghdad is UTC+3: noon UTC is always the same calendar day there. */
const today = (day: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${day}T12:00:00Z`) });

const expenses = () => prisma().accountEntry.findMany({ where: { kind: 'EXPENSE' }, orderBy: { occurredOn: 'asc' }, select: { occurredOn: true, service: true, amountMinor: true, currency: true, recurringMonth: true } });

describe('recurring expenses', () => {
  it('posts one expense for every month that has come due, and never the same month twice', async () => {
    today('2026-11-10');
    dataOf(await run(admin, addAccountRecurring, { service: 'Rent', amount: '500', currency: 'USD', dayOfMonth: 5, startMonth: '2026-09' }));
    expect(dataOf(await run(admin, applyAccountRecurring, {})).posted).toBe(3);
    expect(dataOf(await run(admin, applyAccountRecurring, {})).posted).toBe(0);
    const rows = await expenses();
    expect(rows.map((row) => [row.occurredOn.toISOString().slice(0, 10), row.recurringMonth, row.amountMinor, row.currency, row.service])).toEqual([
      ['2026-09-05', '2026-09', 50_000, 'USD', 'Rent'],
      ['2026-10-05', '2026-10', 50_000, 'USD', 'Rent'],
      ['2026-11-05', '2026-11', 50_000, 'USD', 'Rent'],
    ]);
    expect(await prisma().auditLog.count({ where: { action: 'account.recurring.applied' } })).toBe(1);
  });

  it('waits for the day of the month, then posts it', async () => {
    today('2026-11-10');
    dataOf(await run(admin, addAccountRecurring, { service: 'Salary', amount: '1,000,000', currency: 'IQD', dayOfMonth: 20 }));
    expect(dataOf(await run(admin, applyAccountRecurring, {})).posted).toBe(0);
    today('2026-11-21');
    expect(dataOf(await run(admin, applyAccountRecurring, {})).posted).toBe(1);
    expect((await expenses()).map((row) => row.amountMinor)).toEqual([1_000_000]);
  });

  it('keeps what it posted when it is stopped, and posts nothing more', async () => {
    today('2026-11-10');
    const { id } = dataOf(await run(admin, addAccountRecurring, { service: 'Hosting', amount: '20', currency: 'USD', dayOfMonth: 1 }));
    dataOf(await run(admin, applyAccountRecurring, {}));
    dataOf(await run(admin, archiveAccountRecurring, { id }));
    today('2026-12-10');
    expect(dataOf(await run(admin, applyAccountRecurring, {})).posted).toBe(0);
    expect(await expenses()).toHaveLength(1);
    expect(dataOf(await ask(admin, accountsBook, {})).recurring).toEqual([]);
  });

  it('refuses a bad amount, a bad day and anyone but a Super Admin', async () => {
    expect(failureOf(await run(admin, addAccountRecurring, { service: 'Rent', amount: 'abc', currency: 'USD', dayOfMonth: 5 })).fields?.amount).toBeDefined();
    expect(codeOf(await run(admin, addAccountRecurring, { service: 'Rent', amount: '5', currency: 'USD', dayOfMonth: 31 }))).toBe('INVALID');
    expect(codeOf(await run(cashier, addAccountRecurring, { service: 'Rent', amount: '5', currency: 'USD', dayOfMonth: 5 }))).toBe('FORBIDDEN');
    expect(codeOf(await run(cashier, applyAccountRecurring, {}))).toBe('FORBIDDEN');
    expect(codeOf(await run(admin, archiveAccountRecurring, { id: 'nope' }))).toBe('NOT_FOUND');
  });
});

describe('monthly budgets', () => {
  it('keeps one budget per kind of expense and currency, changes it when set again, and removes it', async () => {
    dataOf(await run(admin, setAccountBudget, { service: 'Subscription', currency: 'USD', amount: '200' }));
    dataOf(await run(admin, setAccountBudget, { service: 'Subscription', currency: 'USD', amount: '250' }));
    dataOf(await run(admin, setAccountBudget, { service: 'Subscription', currency: 'IQD', amount: '300,000' }));
    const book = dataOf(await ask(admin, accountsBook, {}));
    expect(book.budgets.map((row) => [row.service, row.currency, row.limitMinor])).toEqual([
      ['Subscription', 'IQD', 300_000],
      ['Subscription', 'USD', 25_000],
    ]);
    dataOf(await run(admin, removeAccountBudget, { id: book.budgets[0]!.id }));
    expect(dataOf(await ask(admin, accountsBook, {})).budgets).toHaveLength(1);
  });

  it('refuses nothing-amounts, an unknown budget and anyone but a Super Admin', async () => {
    expect(failureOf(await run(admin, setAccountBudget, { service: 'Rent', currency: 'USD', amount: '0' })).fields?.amount).toBeDefined();
    expect(codeOf(await run(admin, removeAccountBudget, { id: 'nope' }))).toBe('NOT_FOUND');
    expect(codeOf(await run(cashier, setAccountBudget, { service: 'Rent', currency: 'USD', amount: '5' }))).toBe('FORBIDDEN');
  });
});
