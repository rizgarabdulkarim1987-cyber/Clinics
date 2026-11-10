import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildStatementWorkbook } from '@/server/accounts/statement';
import type { AccountsBook, BookMovement } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';

const move = (over: Partial<BookMovement>): BookMovement => ({
  id: 'm', kind: 'INCOME', amountMinor: 1_000_000, currency: 'IQD', clientId: 'a', clientName: 'Al Nour', service: 'website', note: '',
  occurredOn: '2026-11-05', recordedAt: '2026-11-05T09:30:00.000Z', rate: null, owed: false, paidMinor: 0, payments: [], attachments: [], ...over,
});

const book: AccountsBook = { quotes: [], recurring: [], budgets: [],
  rate: null,
  clients: [{ id: 'a', name: 'Al Nour', slug: 'al-nour', phone: '' }],
  movements: [
    move({ id: '1' }),
    move({ id: '2', owed: true, amountMinor: 600_000, paidMinor: 200_000, occurredOn: '2026-11-06' }),
    move({ id: '3', kind: 'EXPENSE', amountMinor: 100_000, occurredOn: '2026-11-07' }),
    move({ id: '4', clientId: 'b', clientName: 'Other' }),
  ],
};

describe('a client statement', () => {
  it('lists only that client, with received and remaining, and totals', async () => {
    const built = (await buildStatementWorkbook(book, 'a', getStudioTranslator('en'), 'en'))!;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(built.bytes) as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0]!;
    const row = (n: number) => (sheet.getRow(n).values as unknown[]).slice(1);
    expect([row(2)[5], row(2)[6], row(2)[7]]).toEqual([1_000_000, 1_000_000, 0]);
    expect([row(3)[5], row(3)[6], row(3)[7]]).toEqual([600_000, 200_000, 400_000]);
    expect([row(6)[0], row(6)[5], row(6)[6], row(6)[7]]).toEqual(['Total', 1_500_000, 1_200_000, 400_000]);
  });
  it('is null for an unknown client', async () => {
    expect(await buildStatementWorkbook(book, 'zzz', getStudioTranslator('en'), 'en')).toBeNull();
  });
});
