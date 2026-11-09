import ExcelJS from 'exceljs';
import { ACCOUNT_CURRENCIES, remainingMinor, type AccountCurrency, type AccountMovement } from '@/lib/accounts';
import type { Locale } from '@/lib/locale';
import type { Translate } from '@/lib/i18n';
import type { AccountsBook } from '@/server/studio/queries/accounts';

/**
 * One client's statement: every movement with that client, what was received and what is still owed, and the totals per
 * currency at the bottom. Null when the client does not exist. Numbers in the major unit, never formulas.
 */

const major = (minor: number, currency: AccountCurrency) => (currency === 'IQD' ? minor : minor / 100);
const FORMAT: Record<AccountCurrency, string> = { IQD: '#,##0', USD: '#,##0.00' };

export async function buildStatementWorkbook(book: AccountsBook, clientId: string, t: Translate, locale: Locale): Promise<{ bytes: Uint8Array; name: string } | null> {
  const client = book.clients.find((entry) => entry.id === clientId);
  if (!client) return null;
  const rows = book.movements.filter((row) => row.clientId === clientId).sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(t('accounts.sheet.statement').slice(0, 31), { views: [{ rightToLeft: locale !== 'en', state: 'frozen', ySplit: 1 }] });
  const titles = [t('accounts.col.date'), t('accounts.col.type'), t('accounts.col.service'), t('accounts.col.note'), t('accounts.col.currency'), t('accounts.col.amount'), t('accounts.col.received'), t('accounts.col.remaining')];
  sheet.columns = titles.map((header, index) => ({ header, width: [12, 12, 22, 36, 10, 16, 16, 16][index] }));
  sheet.getRow(1).font = { bold: true };

  const sums: Record<AccountCurrency, { income: number; expense: number; received: number; left: number }> = {
    IQD: { income: 0, expense: 0, received: 0, left: 0 },
    USD: { income: 0, expense: 0, received: 0, left: 0 },
  };
  for (const entry of rows) {
    const income = entry.kind === 'INCOME';
    const left = remainingMinor(entry as AccountMovement);
    // An income that is not marked as owed was received in full.
    const received = income ? (entry.owed ? entry.paidMinor : entry.amountMinor) : 0;
    const row = sheet.addRow([
      new Date(`${entry.occurredOn}T00:00:00.000Z`),
      t(income ? 'accounts.kind.income' : 'accounts.kind.expense'),
      entry.service,
      entry.note,
      entry.currency,
      major(entry.amountMinor, entry.currency),
      income ? major(received, entry.currency) : null,
      income ? major(left, entry.currency) : null,
    ]);
    row.getCell(1).numFmt = 'yyyy-mm-dd';
    for (const column of [6, 7, 8]) row.getCell(column).numFmt = FORMAT[entry.currency];
    const bucket = sums[entry.currency];
    if (income) {
      bucket.income += entry.amountMinor;
      bucket.received += received;
      bucket.left += left;
    } else bucket.expense += entry.amountMinor;
  }

  sheet.addRow([]);
  for (const currency of ACCOUNT_CURRENCIES) {
    const bucket = sums[currency];
    if (bucket.income === 0 && bucket.expense === 0) continue;
    const row = sheet.addRow([t('accounts.clients.total'), '', '', '', currency, major(bucket.income - bucket.expense, currency), major(bucket.received, currency), major(bucket.left, currency)]);
    row.font = { bold: true };
    for (const column of [6, 7, 8]) row.getCell(column).numFmt = FORMAT[currency];
  }

  return { bytes: new Uint8Array(await workbook.xlsx.writeBuffer()), name: client.slug || 'client' };
}
