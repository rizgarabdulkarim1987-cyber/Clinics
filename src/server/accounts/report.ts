import { ACCOUNT_CURRENCIES, byClient, byService, inPeriod, owedTotals, percentChange, periodKey, previousPeriod, summarize, type AccountCurrency, type Period } from '@/lib/accounts';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import type { AccountsBook } from '@/server/studio/queries/accounts';
import { periodText } from './client-invoice';
import { escapeHtml as esc, formatInvoiceMoney, INVOICE_STYLE } from './invoice';

/**
 * The books for one period as a printable page (the browser's Print makes the PDF): what came in and went out per
 * currency with the change since the period before, who the money came from, what it was for, and what is still owed.
 * Dinars and dollars are never added together here: each currency has its own line.
 */

const STYLE = `
  .cmp { font-size: 12px; color: #666; }
  .up { color: #067647; } .down { color: #b42318; }
  table.data { margin-top: 6px; } table.data th, table.data td { padding: 7px 0; border-bottom: 1px solid #e3e3e3; text-align: start; font-weight: 400; vertical-align: top; }
  table.data thead th { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #666; }
  table.data td.num, table.data th.num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .row2 { display: block; }
`;

const arrow = (change: number | null) => (change === null ? '' : change === 0 ? '0%' : `${change > 0 ? '+' : '−'}${Math.abs(change)}%`);

export function renderReportPage(book: AccountsBook, period: Period, t: Translate, locale: Locale): string {
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const key = periodKey(period);
  const rows = inPeriod(book.movements, period);
  const totals = summarize(rows);
  const before = previousPeriod(period);
  const beforeTotals = before ? summarize(inPeriod(book.movements, before)) : null;
  const names = new Map(book.movements.flatMap((row) => (row.clientId && row.clientName ? [[row.clientId, row.clientName] as const] : [])));
  const clients = byClient(rows, names).filter((row) => row.clientId !== null);
  const services = byService(rows);
  const owed = owedTotals(book.movements);
  const money = (minor: number, code: AccountCurrency) => formatInvoiceMoney(minor, code);
  const used = ACCOUNT_CURRENCIES.filter((code) => totals[code].income !== 0 || totals[code].expense !== 0);

  const switcher = (['ar', 'ckb', 'en'] as const)
    .map((code) => `<a href="/agency/report?period=${encodeURIComponent(key)}&amp;lang=${code}"${code === locale ? ' aria-current="true"' : ''}>${code === 'en' ? 'English' : code === 'ar' ? 'العربية' : 'کوردی'}</a>`)
    .join('');

  const change = (code: AccountCurrency, pick: 'income' | 'expense' | 'net', goodWhenUp: boolean) => {
    if (!beforeTotals) return '';
    const value = percentChange(totals[code][pick], beforeTotals[code][pick]);
    if (value === null) return '';
    const good = value === 0 ? null : value > 0 === goodWhenUp;
    return `<span class="cmp ${good === null ? '' : good ? 'up' : 'down'}" dir="ltr"> ${esc(arrow(value))}</span>`;
  };

  const totalsRows = used
    .map(
      (code) =>
        `<tr><th scope="row">${esc(code)}</th><td class="num" dir="ltr">${esc(money(totals[code].income, code))}${change(code, 'income', true)}</td><td class="num" dir="ltr">${esc(money(totals[code].expense, code))}${change(code, 'expense', false)}</td><td class="num" dir="ltr"><strong>${esc(money(totals[code].net, code))}</strong>${change(code, 'net', true)}</td></tr>`,
    )
    .join('');

  const clientRows = clients
    .map((row) => {
      const cells = (pick: 'income' | 'net') => ACCOUNT_CURRENCIES.filter((code) => row.totals[code].income !== 0 || row.totals[code].expense !== 0).map((code) => `<span class="row2" dir="ltr">${esc(money(row.totals[code][pick], code))}</span>`).join('');
      return `<tr><th scope="row">${esc(row.name ?? '')}</th><td class="num">${cells('income')}</td><td class="num">${cells('net')}</td></tr>`;
    })
    .join('');

  const serviceRows = services
    .map((row) => {
      const cells = ACCOUNT_CURRENCIES.filter((code) => row.totals[code].income > 0).map((code) => `<span class="row2" dir="ltr">${esc(money(row.totals[code].income, code))}</span>`).join('');
      return `<tr><th scope="row">${esc(row.service || t('accounts.services.none'))}</th><td class="num">${cells}</td></tr>`;
    })
    .join('');

  const spendByService = new Map<string, Record<AccountCurrency, number>>();
  for (const row of rows) {
    if (row.kind !== 'EXPENSE') continue;
    const name = row.service.trim();
    const entry = spendByService.get(name) ?? { IQD: 0, USD: 0 };
    entry[row.currency] += row.amountMinor;
    spendByService.set(name, entry);
  }
  const spendRows = [...spendByService.entries()]
    .sort((a, b) => b[1].IQD + b[1].USD * 1500 - (a[1].IQD + a[1].USD * 1500))
    .map(([name, sums]) => `<tr><th scope="row">${esc(name || t('accounts.services.none'))}</th><td class="num">${ACCOUNT_CURRENCIES.filter((code) => sums[code] > 0).map((code) => `<span class="row2" dir="ltr">${esc(money(sums[code], code))}</span>`).join('')}</td></tr>`)
    .join('');

  const owedLine = ACCOUNT_CURRENCIES.filter((code) => owed[code].income > 0).map((code) => `<span dir="ltr">${esc(money(owed[code].income, code))}</span>`).join(' · ');
  const section = (title: string, head: string, body: string) => (body ? `<h2>${esc(title)}</h2><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` : '');

  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(`${t('accounts.report.title')} - ${periodText(key, t, locale)}`)}</title>
<style>${INVOICE_STYLE}${STYLE}</style>
</head>
<body>
<div class="bar"><nav aria-label="Language">${switcher}</nav><button type="button" onclick="window.print()">${esc(t('accounts.invoice.print'))}</button></div>
<main class="sheet">
  <header>
    <img src="/agency/logo.webp" alt="Buzzify" width="96" height="96">
    <div class="meta">
      <h1>${esc(t('accounts.report.title'))}</h1>
      <div class="no">${esc(periodText(key, t, locale))}</div>
      ${before ? `<div class="period">${esc(t('accounts.report.vs', { period: periodText(periodKey(before), t, locale) }))}</div>` : ''}
    </div>
  </header>
  ${used.length === 0 ? `<p>${esc(t('accounts.summary.nothing'))}</p>` : ''}
  ${section(t('accounts.report.totals'), `<th></th><th class="num">${esc(t('accounts.summary.income'))}</th><th class="num">${esc(t('accounts.summary.expense'))}</th><th class="num">${esc(t('accounts.summary.net'))}</th>`, totalsRows)}
  ${section(t('accounts.clients.title'), `<th>${esc(t('accounts.col.client'))}</th><th class="num">${esc(t('accounts.col.income'))}</th><th class="num">${esc(t('accounts.col.net'))}</th>`, clientRows)}
  ${section(t('accounts.services.title'), `<th>${esc(t('accounts.col.service'))}</th><th class="num">${esc(t('accounts.col.income'))}</th>`, serviceRows)}
  ${section(t('accounts.report.spend'), `<th>${esc(t('accounts.col.service'))}</th><th class="num">${esc(t('accounts.col.expense'))}</th>`, spendRows)}
  ${owedLine ? `<h2>${esc(t('accounts.owed.title'))}</h2><p style="font-size:18px;font-weight:700">${owedLine}</p>` : ''}
  <footer>${esc(t('accounts.report.note'))}</footer>
</main>
</body>
</html>`;
}
