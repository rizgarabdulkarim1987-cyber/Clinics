import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { quoteNumber, quoteState, renderQuotePage } from '@/server/accounts/quote';
import { archiveAccountClient, archiveAccountQuote, createAccountClient, createAccountQuote, decideAccountQuote } from '@/server/studio/actions/accounts';
import { accountQuote, accountsBook } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let admin: Person;
let cashier: Person;

beforeAll(() => useTestDatabase());
beforeEach(async () => {
  await resetWorld();
  const r = await restaurant('Quotes A');
  admin = await person('admin', { superAdmin: true });
  cashier = await person('cashier', { staff: [r.id, 'CASHIER'] });
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-10T12:00:00Z') });
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const client = async () => dataOf(await run(admin, createAccountClient, { name: 'Al Nour', phone: '0770' })).id as string;
const quote = async (clientId: string, over: Record<string, unknown> = {}) => dataOf(await run(admin, createAccountQuote, { clientId, service: 'Website', amount: '1,200', currency: 'USD', validDays: 14, ...over }));

describe('quotes', () => {
  it('numbers each quote once, dates it, and says until when it stands', async () => {
    const id = await client();
    const first = await quote(id);
    const second = await quote(id, { validDays: 30 });
    expect(second.number).toBe(first.number + 1);
    const book = dataOf(await ask(admin, accountsBook, {}));
    expect(book.quotes.map((row) => [row.number, row.issuedOn, row.validUntil, row.amountMinor, row.status])).toEqual([
      [second.number, '2026-11-10', '2026-12-10', 120_000, 'OPEN'],
      [first.number, '2026-11-10', '2026-11-24', 120_000, 'OPEN'],
    ]);
    expect(await prisma().auditLog.count({ where: { action: 'account.quote.created' } })).toBe(2);
  });

  it('turns an accepted quote into income the client owes, once', async () => {
    const id = await client();
    const made = await quote(id);
    const { entryId } = dataOf(await run(admin, decideAccountQuote, { id: made.id, decision: 'ACCEPT' }));
    const entry = await prisma().accountEntry.findUniqueOrThrow({ where: { id: entryId! } });
    expect(entry).toMatchObject({ kind: 'INCOME', owed: true, clientId: id, amountMinor: 120_000, currency: 'USD', service: 'Website' });
    expect(codeOf(await run(admin, decideAccountQuote, { id: made.id, decision: 'ACCEPT' }))).toBe('INVALID');
    expect(dataOf(await ask(admin, accountsBook, {})).quotes[0]!.status).toBe('ACCEPTED');
    expect(await prisma().accountEntry.count()).toBe(1);
  });

  it('keeps a declined quote out of the books', async () => {
    const made = await quote(await client());
    dataOf(await run(admin, decideAccountQuote, { id: made.id, decision: 'DECLINE' }));
    expect(await prisma().accountEntry.count()).toBe(0);
    expect(dataOf(await ask(admin, accountsBook, {})).quotes[0]!.status).toBe('DECLINED');
    expect(codeOf(await run(admin, decideAccountQuote, { id: made.id, decision: 'ACCEPT' }))).toBe('INVALID');
  });

  it('removes a quote from the list but keeps its row, and refuses bad input and anyone but a Super Admin', async () => {
    const id = await client();
    const made = await quote(id);
    dataOf(await run(admin, archiveAccountQuote, { id: made.id }));
    expect(dataOf(await ask(admin, accountsBook, {})).quotes).toEqual([]);
    expect(await prisma().accountQuote.count()).toBe(1);
    expect(codeOf(await ask(admin, accountQuote, { id: made.id }))).toBe('NOT_FOUND');

    expect(failureOf(await run(admin, createAccountQuote, { clientId: id, service: 'X', amount: '0', currency: 'USD', validDays: 14 })).fields?.amount).toBeDefined();
    expect(codeOf(await run(admin, createAccountQuote, { clientId: id, service: 'X', amount: '5', currency: 'USD', validDays: 5 }))).toBe('INVALID');
    expect(codeOf(await run(admin, createAccountQuote, { clientId: 'nope', service: 'X', amount: '5', currency: 'USD', validDays: 14 }))).toBe('NOT_FOUND');
    expect(codeOf(await run(cashier, createAccountQuote, { clientId: id, service: 'X', amount: '5', currency: 'USD', validDays: 14 }))).toBe('FORBIDDEN');
    expect(codeOf(await run(cashier, decideAccountQuote, { id: made.id, decision: 'DECLINE' }))).toBe('FORBIDDEN');
  });

  it('cannot be accepted for a client who has been archived', async () => {
    const id = await client();
    const made = await quote(id);
    dataOf(await run(admin, archiveAccountClient, { id }));
    expect(codeOf(await run(admin, decideAccountQuote, { id: made.id, decision: 'ACCEPT' }))).toBe('NOT_FOUND');
  });
});

describe('the quote page', () => {
  const data = { id: 'q1', number: 7, clientId: 'c1', clientName: 'Al <Nour>', clientPhone: '0770', service: '<b>Website</b>', note: 'with "design"', amountMinor: 123_456, currency: 'USD' as const, issuedOn: '2026-11-10', validUntil: '2026-11-24', status: 'OPEN' as const };

  it('numbers it QUO-0007, escapes everything and shows the date it stands until', () => {
    const html = renderQuotePage(data, getStudioTranslator('en'), 'en', '2026-11-10');
    expect(quoteNumber(7)).toBe('QUO-0007');
    expect(html).toContain('QUO-0007');
    expect(html).toContain('Al &lt;Nour&gt;');
    expect(html).toContain('&lt;b&gt;Website&lt;/b&gt;');
    expect(html).not.toContain('<b>Website</b>');
    expect(html).toContain('$1,234.56');
    expect(html).toContain('2026-11-24');
  });

  it('says when a quote has run out, and reads right to left in Arabic', () => {
    expect(quoteState(data, '2026-11-25')).toBe('expired');
    expect(quoteState(data, '2026-11-24')).toBe('open');
    expect(quoteState({ ...data, status: 'ACCEPTED' }, '2030-01-01')).toBe('accepted');
    expect(renderQuotePage(data, getStudioTranslator('ar'), 'ar', '2026-11-10')).toContain('dir="rtl"');
  });
});
