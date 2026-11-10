import { describe, expect, it } from 'vitest';
import { renderReportPage } from '@/server/accounts/report';
import type { AccountsBook, BookMovement } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';

const row = (over: Partial<BookMovement>): BookMovement => ({
  id: Math.random().toString(36).slice(2),
  kind: 'INCOME',
  amountMinor: 0,
  currency: 'IQD',
  clientId: 'c1',
  clientName: 'Al <Nour>',
  service: 'Website',
  note: '',
  occurredOn: '2026-11-05',
  recordedAt: '2026-11-05T09:00:00Z',
  rate: null,
  owed: false,
  paidMinor: 0,
  payments: [],
  attachments: [],
  ...over,
});

const book: AccountsBook = {
  recurring: [],
  budgets: [],
  clients: [{ id: 'c1', name: 'Al <Nour>', slug: 'al-nour', phone: '' }],
  rate: null,
  movements: [
    row({ amountMinor: 1_500_000, paidMinor: 1_500_000 }),
    row({ kind: 'EXPENSE', clientId: null, clientName: null, service: 'Rent', amountMinor: 500_000 }),
    row({ amountMinor: 1_000_000, paidMinor: 1_000_000, occurredOn: '2026-10-12' }),
    row({ currency: 'USD', amountMinor: 20_000, owed: true, paidMinor: 5_000, service: 'Hosting', occurredOn: '2026-11-20' }),
  ],
};

describe('the printable report', () => {
  const html = renderReportPage(book, { kind: 'month', year: 2026, month: 11 }, getStudioTranslator('en'), 'en');

  it('prints each currency on its own with the change against the month before', () => {
    expect(html).toContain('November 2026');
    expect(html).toContain('Compared with October 2026');
    expect(html).toContain('1,500,000 IQD');
    expect(html).toContain('500,000 IQD');
    expect(html).toContain('$200.00');
    // Income went from 1,000,000 to 1,500,000 dinars: up 50%.
    expect(html).toContain('+50%');
  });

  it('lists clients, services, what the money was spent on, and what is still owed, all escaped', () => {
    expect(html).toContain('Al &lt;Nour&gt;');
    expect(html).not.toContain('Al <Nour>');
    expect(html).toContain('Website');
    expect(html).toContain('Rent');
    // Owed: 200 dollars billed, 50 received.
    expect(html).toContain('$150.00');
  });

  it('reads right to left in Arabic, and says so when nothing was recorded', () => {
    expect(renderReportPage(book, { kind: 'month', year: 2026, month: 11 }, getStudioTranslator('ar'), 'ar')).toContain('dir="rtl"');
    expect(renderReportPage(book, { kind: 'month', year: 2020, month: 1 }, getStudioTranslator('en'), 'en')).toContain('Nothing recorded in this period.');
  });
});
