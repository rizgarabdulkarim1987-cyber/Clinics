import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildBookWorkbook } from '@/server/accounts/workbook';
import type { AccountsBook, BookMovement } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';

const move = (over: Partial<BookMovement>): BookMovement => ({
  id: 'm',
  kind: 'INCOME',
  amountMinor: 1_000_000,
  currency: 'IQD',
  clientId: 'a',
  clientName: 'Al Nour',
  service: 'website',
  note: '',
  occurredOn: '2026-11-05',
  recordedAt: '2026-11-05T09:30:00.000Z',
  rate: null,
  owed: false,
  paidMinor: 0,
  payments: [], attachments: [],
  ...over,
});

const book: AccountsBook = {
  rate: null,
  clients: [{ id: 'a', name: 'Al Nour', slug: 'al-nour', phone: '' }],
  movements: [
    move({ id: '1' }),
    move({ id: '2', kind: 'EXPENSE', amountMinor: 250_000, clientId: null, clientName: null, service: 'equipment', occurredOn: '2026-11-06' }),
    move({ id: '3', currency: 'USD', amountMinor: 12_550, clientId: 'a', service: 'ads', occurredOn: '2026-11-07' }),
    move({ id: '4', note: '=HYPERLINK("x")', occurredOn: '2025-03-01' }),
  ],
};

async function open(period: Parameters<typeof buildBookWorkbook>[1], locale: 'en' | 'ar' = 'en', rate: number | null = null) {
  const bytes = await buildBookWorkbook({ ...book, rate }, period, getStudioTranslator(locale), locale);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  return workbook;
}

describe('the Excel file', () => {
  it('has a summary, a clients sheet and a movements sheet', async () => {
    const workbook = await open({ kind: 'month', year: 2026, month: 11 });
    expect(workbook.worksheets).toHaveLength(3);
    expect(workbook.worksheets.every((sheet) => sheet.name.length > 0 && sheet.name.length <= 31)).toBe(true);
  });

  it('keeps only the chosen period, in every sheet', async () => {
    const workbook = await open({ kind: 'month', year: 2026, month: 11 });
    const movements = workbook.worksheets[2]!;
    // header + the three movements of November 2026; the 2025 one is out.
    expect(movements.rowCount).toBe(4);
    expect((await open({ kind: 'all' })).worksheets[2]!.rowCount).toBe(5);
  });

  it('writes amounts as numbers in the major unit and keeps the currencies apart', async () => {
    const summary = (await open({ kind: 'month', year: 2026, month: 11 })).worksheets[0]!;
    const rows = summary.getRows(1, summary.rowCount)!.map((row) => (row.values as unknown[]).slice(1));
    const dinar = rows.find((row) => row.includes('IQD'))!;
    const dollar = rows.find((row) => row.includes('USD'))!;
    expect(dinar.filter((cell) => typeof cell === 'number')).toEqual([1_000_000, 250_000, 750_000]);
    expect(dollar.filter((cell) => typeof cell === 'number')).toEqual([125.5, 0, 125.5]);
  });

  it('gives each movement a real date, and a signed amount that adds up', async () => {
    const sheet = (await open({ kind: 'month', year: 2026, month: 11 })).worksheets[2]!;
    const dataRows = sheet.getRows(2, 3)!.map((row) => row.values as unknown[]);
    expect(dataRows[0]![1]).toBeInstanceOf(Date);
    const signed = dataRows.filter((row) => row.includes('IQD')).map((row) => row[8]);
    expect(signed.reduce((sum, value) => (sum as number) + (value as number), 0)).toBe(750_000);
  });

  it('writes the movements with no client as their own row in the clients sheet', async () => {
    const sheet = (await open({ kind: 'month', year: 2026, month: 11 })).worksheets[1]!;
    const names = sheet.getRows(2, sheet.rowCount - 1)!.map((row) => (row.values as unknown[])[1]);
    expect(names).toContain('Al Nour');
    expect(names).toContain(getStudioTranslator('en')('accounts.noClient'));
  });

  it('never turns a note into a formula', async () => {
    const sheet = (await open({ kind: 'all' })).worksheets[2]!;
    const cells = sheet.getRows(2, sheet.rowCount - 1)!.flatMap((row) => (row.values as unknown[]).slice(1));
    expect(cells.some((cell) => typeof cell === 'object' && cell !== null && 'formula' in (cell as object))).toBe(false);
    expect(cells).toContain('=HYPERLINK("x")');
  });

  it('reads right to left in Arabic', async () => {
    const workbook = await open({ kind: 'all' }, 'ar');
    expect(workbook.worksheets.every((sheet) => sheet.views[0]?.rightToLeft === true)).toBe(true);
    expect((await open({ kind: 'all' }, 'en')).worksheets.some((sheet) => sheet.views[0]?.rightToLeft)).toBe(false);
  });
});

describe('with an exchange rate', () => {
  const rows = async (rate: number | null) => {
    const summary = (await open({ kind: 'month', year: 2026, month: 11 }, 'en', rate)).worksheets[0]!;
    return summary.getRows(1, summary.rowCount)!.map((row) => (row.values as unknown[]).slice(1));
  };

  it('shows everything in dinars and everything in dollars, and says which rate', async () => {
    const all = await rows(1500);
    // Income 1,000,000 dinars + $125.50 (188,250 dinars); expense 250,000 dinars.
    expect(all.find((row) => row[0] === 'IQD')!.slice(1)).toEqual([1_188_250, 250_000, 938_250]);
    // The same in dollars: 1,000,000 / 1500 = 666.67 plus 125.50; 250,000 / 1500 = 166.67.
    expect(all.find((row) => row[0] === 'USD')!.slice(1)).toEqual([792.17, 166.67, 625.5]);
    expect(all.find((row) => typeof row[0] === 'string' && (row[0] as string).startsWith('Exchange rate'))![1]).toBe(1500);
  });

  it('keeps the currencies apart without a rate', async () => {
    const all = await rows(null);
    expect(all.find((row) => row[0] === 'IQD')!.slice(1)).toEqual([1_000_000, 250_000, 750_000]);
    expect(all.some((row) => typeof row[0] === 'string' && (row[0] as string).startsWith('Exchange rate'))).toBe(false);
  });
});

describe('the movements sheet in full', () => {
  it('writes each movement in dinars and in dollars, signed, when there is a rate, and when it was typed in', async () => {
    const sheet = (await open({ kind: 'month', year: 2026, month: 11 }, 'en', 1500)).worksheets[2]!;
    const rows = sheet.getRows(2, 3)!.map((row) => row.values as unknown[]);
    // Oldest first: the 1,000,000 dinar income, the 250,000 dinar expense, then the $125.50 income.
    expect(rows[0]!.slice(9, 11)).toEqual([1_000_000, 666.67]);
    expect(rows[1]!.slice(9, 11)).toEqual([-250_000, -166.67]);
    expect(rows[2]!.slice(9, 11)).toEqual([188_250, 125.5]);
    expect(rows[0]![12]).toBeInstanceOf(Date);
    expect(rows.map((row) => row[11])).toEqual([1500, 1500, 1500]);
  });
  it('still lists every movement with its date, client, service and note, and when typed in, without a rate', async () => {
    const sheet = (await open({ kind: 'all' })).worksheets[2]!;
    const first = (sheet.getRow(2).values as unknown[]).slice(1);
    expect(first).toHaveLength(9);
    expect(first[0]).toBeInstanceOf(Date);
    expect(first[8]).toBeInstanceOf(Date);
  });
});

describe('a movement keeps its own rate', () => {
  it('converts each movement at the rate it was typed in with, not the current one', async () => {
    const own: AccountsBook = {
      rate: 1400,
      clients: [],
      movements: [
        move({ id: 'a', currency: 'USD', amountMinor: 10_000, rate: 1500, occurredOn: '2026-11-01', clientId: null, clientName: null }), // $100 at 1,500
        move({ id: 'b', currency: 'USD', amountMinor: 10_000, rate: 1400, occurredOn: '2026-11-02', clientId: null, clientName: null }), // $100 at 1,400
      ],
    };
    const bytes = await buildBookWorkbook(own, { kind: 'month', year: 2026, month: 11 }, getStudioTranslator('en'), 'en');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    const rows = workbook.worksheets[2]!.getRows(2, 2)!.map((row) => row.values as unknown[]);
    expect(rows.map((row) => [row[9], row[11]])).toEqual([[150_000, 1500], [140_000, 1400]]);
    const summary = workbook.worksheets[0]!;
    const iqd = summary.getRows(1, summary.rowCount)!.map((row) => (row.values as unknown[]).slice(1)).find((row) => row[0] === 'IQD')!;
    expect(iqd[1]).toBe(290_000);
  });
});
