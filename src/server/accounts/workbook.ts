import ExcelJS from 'exceljs';
import { ACCOUNT_CURRENCIES, byClient, convertTotals, inPeriod, summarize, type AccountCurrency, type AccountMovement, type Period } from '@/lib/accounts';
import type { Locale } from '@/lib/locale';
import type { Translate } from '@/lib/i18n';
import type { AccountsBook } from '@/server/studio/queries/accounts';

/**
 * The Excel file of the agency's books: a summary, each client's profit, and every movement of the chosen period. Money
 * is written as numbers in the major unit (dinars, or dollars with cents) so Excel can add them; the currencies are never
 * mixed in one total. Cells are real strings or numbers, never formulas, so a note that starts with `=` stays text.
 */

const major = (minor: number, currency: AccountCurrency) => (currency === 'IQD' ? minor : minor / 100);
const FORMAT: Record<AccountCurrency, string> = { IQD: '#,##0', USD: '#,##0.00' };

function periodLabel(period: Period, locale: Locale): string {
  if (period.kind === 'all') return '';
  if (period.kind === 'year') return String(period.year);
  const name = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ar-IQ', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(period.year, period.month - 1, 1)));
  return `${name} ${period.year}`;
}

export async function buildBookWorkbook(book: AccountsBook, period: Period, t: Translate, locale: Locale): Promise<Uint8Array> {
  const movements = inPeriod(book.movements, period);
  const rightToLeft = locale !== 'en';
  const workbook = new ExcelJS.Workbook();
  const sheet = (name: string) => workbook.addWorksheet(name, { views: [{ rightToLeft, state: 'frozen', ySplit: 1 }] });
  const head = (target: ExcelJS.Worksheet, titles: string[], widths: number[]) => {
    target.columns = titles.map((title, index) => ({ header: title, width: widths[index] ?? 14 }));
    target.getRow(1).font = { bold: true };
  };
  const money = (cell: ExcelJS.Cell, currency: AccountCurrency) => {
    cell.numFmt = FORMAT[currency];
  };

  // Summary: one row per currency that has any movement (both when there is none, so the sheet is never empty).
  // With a rate, everything is shown twice over: all of it in dinars and all of it in dollars; without one, apart.
  const rate = book.rate;
  const convert = (value: ReturnType<typeof summarize>) => (rate === null ? value : convertTotals(value, rate));
  const totals = convert(summarize(movements as AccountMovement[]));
  const summary = sheet(t('accounts.sheet.summary'));
  head(summary, [periodLabel(period, locale) || t('accounts.period.kind.all'), t('accounts.col.income'), t('accounts.col.expense'), t('accounts.col.net')], [18, 18, 18, 18]);
  const used = rate === null ? ACCOUNT_CURRENCIES.filter((currency) => movements.some((row) => row.currency === currency)) : [];
  for (const currency of used.length ? used : ACCOUNT_CURRENCIES) {
    const row = summary.addRow([currency, major(totals[currency].income, currency), major(totals[currency].expense, currency), major(totals[currency].net, currency)]);
    for (let column = 2; column <= 4; column += 1) money(row.getCell(column), currency);
  }

  if (rate !== null) {
    const rateRow = summary.addRow([t('accounts.sheet.rate'), rate]);
    rateRow.getCell(2).numFmt = '#,##0';
  }

  // Clients: each client once per currency it moved money in.
  const names = new Map(book.clients.map((client) => [client.id, client.name]));
  for (const row of movements) if (row.clientId && row.clientName) names.set(row.clientId, row.clientName);
  const clients = sheet(t('accounts.sheet.clients'));
  head(clients, [t('accounts.col.client'), t('accounts.col.currency'), t('accounts.col.income'), t('accounts.col.expense'), t('accounts.col.net')], [28, 10, 18, 18, 18]);
  for (const entry of byClient(movements as AccountMovement[], names).map((row) => ({ ...row, totals: convert(row.totals) }))) {
    for (const currency of ACCOUNT_CURRENCIES) {
      const sums = entry.totals[currency];
      if (sums.income === 0 && sums.expense === 0) continue;
      const row = clients.addRow([entry.name ?? t('accounts.noClient'), currency, major(sums.income, currency), major(sums.expense, currency), major(sums.net, currency)]);
      for (let column = 3; column <= 5; column += 1) money(row.getCell(column), currency);
    }
  }

  // Movements: oldest first, as a ledger reads; the signed column is what a SUM should add.
  const list = sheet(t('accounts.sheet.movements'));
  head(list, [t('accounts.col.date'), t('accounts.col.type'), t('accounts.col.client'), t('accounts.col.service'), t('accounts.col.note'), t('accounts.col.currency'), t('accounts.col.amount'), t('accounts.col.signed')], [12, 12, 26, 20, 36, 10, 16, 16]);
  for (const entry of [...movements].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))) {
    const amount = major(entry.amountMinor, entry.currency);
    const row = list.addRow([
      new Date(`${entry.occurredOn}T00:00:00.000Z`),
      t(entry.kind === 'INCOME' ? 'accounts.kind.income' : 'accounts.kind.expense'),
      entry.clientName ?? t('accounts.noClient'),
      entry.service,
      entry.note,
      entry.currency,
      amount,
      entry.kind === 'INCOME' ? amount : -amount,
    ]);
    row.getCell(1).numFmt = 'yyyy-mm-dd';
    money(row.getCell(7), entry.currency);
    money(row.getCell(8), entry.currency);
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
