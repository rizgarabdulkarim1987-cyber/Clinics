import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInvoicePage, formatInvoiceMoney } from '@/server/accounts/invoice';
import { addAccountEntry, addAccountPayment, createAccountClient, issueAccountInvoice } from '@/server/studio/actions/accounts';
import { accountInvoice } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let admin: Person;
let cashier: Person;

beforeAll(() => useTestDatabase());
beforeEach(async () => {
  await resetWorld();
  const r = await restaurant('Invoice A');
  admin = await person('admin', { superAdmin: true });
  cashier = await person('cashier', { staff: [r.id, 'CASHIER'] });
});
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const income = async (extra: Record<string, unknown> = {}) => {
  const client = dataOf(await run(admin, createAccountClient, { name: 'Al Nour', phone: '0770 000 0000' }));
  return dataOf(await run(admin, addAccountEntry, { kind: 'INCOME', amount: '1,000', currency: 'USD', occurredOn: '2026-11-01', clientId: client.id, service: 'Branding', note: 'logo + kit', ...extra })).id as string;
};

describe('an invoice for an income', () => {
  it('gives a number once, keeps it, and numbers the next income after it', async () => {
    const a = await income();
    const b = await income();
    const first = dataOf(await run(admin, issueAccountInvoice, { entryId: a }));
    expect(dataOf(await run(admin, issueAccountInvoice, { entryId: a }))).toEqual(first);
    expect(dataOf(await run(admin, issueAccountInvoice, { entryId: b })).number).toBe(first.number + 1);
    expect(await prisma().auditLog.count({ where: { action: 'account.invoice.issued' } })).toBe(2);
  });

  it('reads a paid-in-full income as one payment, and an owed one as the payments received', async () => {
    const paid = await income();
    dataOf(await run(admin, issueAccountInvoice, { entryId: paid }));
    const full = dataOf(await ask(admin, accountInvoice, { entryId: paid }));
    expect(full).toMatchObject({ amountMinor: 100_000, paidMinor: 100_000, clientName: 'Al Nour', clientPhone: '0770 000 0000' });
    expect(full.payments).toEqual([expect.objectContaining({ amountMinor: 100_000, paidOn: '2026-11-01', note: 'logo + kit' })]);

    const owing = await income({ owed: true });
    dataOf(await run(admin, issueAccountInvoice, { entryId: owing }));
    dataOf(await run(admin, addAccountPayment, { entryId: owing, amount: '250', paidOn: '2026-11-05', note: 'cash' }));
    const part = dataOf(await ask(admin, accountInvoice, { entryId: owing }));
    expect(part.paidMinor).toBe(25_000);
    expect(part.payments.map((p) => [p.amountMinor, p.paidOn, p.note])).toEqual([[25_000, '2026-11-05', 'cash']]);
  });

  it('refuses an expense, an unknown entry, an entry with no invoice yet, and anyone but a Super Admin', async () => {
    const expense = await income({ kind: 'EXPENSE' });
    expect(codeOf(await run(admin, issueAccountInvoice, { entryId: expense }))).toBe('NOT_FOUND');
    expect(codeOf(await run(admin, issueAccountInvoice, { entryId: 'nope' }))).toBe('NOT_FOUND');
    const open = await income();
    expect(codeOf(await ask(admin, accountInvoice, { entryId: open }))).toBe('NOT_FOUND');
    expect(codeOf(await run(cashier, issueAccountInvoice, { entryId: open }))).toBe('FORBIDDEN');
  });
});

describe('the invoice page', () => {
  const data = {
    number: 7,
    issuedOn: '2026-11-10',
    occurredOn: '2026-11-01',
    currency: 'USD' as const,
    amountMinor: 123_456,
    paidMinor: 50_000,
    service: '<b>Branding</b>',
    note: 'logo "kit"',
    clientName: 'Al <Nour>',
    clientPhone: '0770',
    payments: [{ id: 'p', amountMinor: 50_000, paidOn: '2026-11-05', note: 'cash' }],
  };

  it('formats money with Latin digits and escapes everything it prints', () => {
    expect(formatInvoiceMoney(1_500_000, 'IQD')).toBe('1,500,000 IQD');
    expect(formatInvoiceMoney(123_456, 'USD')).toBe('$1,234.56');
    const html = renderInvoicePage(data, getStudioTranslator('en'), 'en', { entryId: 'e1' });
    expect(html).toContain('INV-0007');
    expect(html).toContain('Al &lt;Nour&gt;');
    expect(html).toContain('&lt;b&gt;Branding&lt;/b&gt;');
    expect(html).not.toContain('<b>Branding</b>');
    expect(html).toContain('$734.56');
    expect(html).toContain('Partially paid');
    expect(html).toContain('/agency/logo.webp');
  });

  it('reads right to left in Arabic and Sorani', () => {
    expect(renderInvoicePage(data, getStudioTranslator('ar'), 'ar', { entryId: 'e1' })).toContain('dir="rtl"');
    expect(renderInvoicePage(data, getStudioTranslator('en'), 'en', { entryId: 'e1' })).toContain('dir="ltr"');
  });
});
