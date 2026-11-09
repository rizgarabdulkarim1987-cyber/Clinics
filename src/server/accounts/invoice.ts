import type { AccountCurrency } from '@/lib/accounts';
import type { Locale } from '@/lib/locale';
import type { Translate } from '@/lib/i18n';
import type { InvoiceData } from '@/server/studio/queries/accounts';

/**
 * One invoice as a self-contained, printable page (A4): the browser's Print gives the PDF. Every value is escaped; the
 * numbers use Latin digits in every language so an amount reads the same on the page and in the books.
 */

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function formatInvoiceMoney(minor: number, currency: AccountCurrency): string {
  if (currency === 'IQD') return `${new Intl.NumberFormat('en-US').format(minor)} IQD`;
  return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
}

export const invoiceNumber = (n: number) => `INV-${String(n).padStart(4, '0')}`;

export function renderInvoicePage(data: InvoiceData, t: Translate, locale: Locale, links: { entryId: string }): string {
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const left = data.amountMinor - data.paidMinor;
  const status = left <= 0 ? 'paid' : data.paidMinor > 0 ? 'part' : 'unpaid';
  const money = (minor: number) => formatInvoiceMoney(minor, data.currency);
  const row = (label: string, value: string, strong = false) => `<tr${strong ? ' class="strong"' : ''}><th scope="row">${escape(label)}</th><td dir="ltr">${escape(value)}</td></tr>`;
  const switcher = (['ar', 'ckb', 'en'] as const)
    .map((code) => `<a href="/agency/invoice?entry=${encodeURIComponent(links.entryId)}&amp;lang=${code}"${code === locale ? ' aria-current="true"' : ''}>${code === 'en' ? 'English' : code === 'ar' ? 'العربية' : 'کوردی'}</a>`)
    .join('');
  const payments = data.payments.length
    ? `<h2>${escape(t('accounts.invoice.payments'))}</h2><table class="lines">${data.payments
        .map((payment) => `<tr><td>${escape(payment.paidOn)}${payment.note ? ` · ${escape(payment.note)}` : ''}</td><td dir="ltr" class="num">${escape(money(payment.amountMinor))}</td></tr>`)
        .join('')}</table>`
    : '';

  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(invoiceNumber(data.number))}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f2f0; color: #111; font: 15px/1.55 system-ui, 'Segoe UI', Tahoma, sans-serif; }
  .bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; max-width: 794px; margin: 16px auto 0; padding: 0 16px; }
  .bar nav { display: flex; gap: 14px; }
  .bar a { color: #111; }
  .bar a[aria-current] { font-weight: 700; text-decoration: none; }
  button { font: inherit; padding: 9px 18px; border: 0; border-radius: 6px; background: #111; color: #fff; cursor: pointer; }
  .sheet { max-width: 794px; margin: 16px auto 40px; background: #fff; padding: 48px 48px 56px; border: 1px solid #ddd; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-bottom: 24px; border-bottom: 2px solid #111; }
  header img { width: 96px; height: 96px; display: block; }
  header .meta { text-align: end; }
  h1 { margin: 0; font-size: 30px; letter-spacing: .02em; }
  .no { font-size: 17px; font-weight: 700; margin-top: 4px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 28px 0; }
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #666; }
  .grid p { margin: 2px 0 0; font-size: 17px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  .lines th, .lines td { padding: 10px 0; border-bottom: 1px solid #e3e3e3; text-align: start; font-weight: 400; vertical-align: top; }
  .lines td.num, table.totals td { text-align: end; white-space: nowrap; }
  table.totals { margin-top: 20px; max-width: 360px; margin-inline-start: auto; }
  table.totals th { text-align: start; font-weight: 400; padding: 6px 0; color: #444; }
  table.totals td { padding: 6px 0; font-variant-numeric: tabular-nums; }
  table.totals tr.strong th, table.totals tr.strong td { border-top: 2px solid #111; padding-top: 10px; font-weight: 700; font-size: 18px; color: #111; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #666; margin: 32px 0 6px; }
  .status { display: inline-block; margin-top: 8px; padding: 3px 12px; border-radius: 99px; font-size: 13px; font-weight: 700; border: 1.5px solid #111; }
  footer { margin-top: 48px; text-align: center; color: #666; font-size: 13px; }
  @media print { body { background: #fff; } .bar { display: none; } .sheet { margin: 0; border: 0; padding: 0; max-width: none; } }
  @media (max-width: 600px) { .sheet { padding: 24px 18px 32px; } .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="bar"><nav aria-label="Language">${switcher}</nav><button type="button" onclick="window.print()">${escape(t('accounts.invoice.print'))}</button></div>
<main class="sheet">
  <header>
    <img src="/agency/logo.webp" alt="Buzzify" width="96" height="96">
    <div class="meta">
      <h1>${escape(t('accounts.invoice.title'))}</h1>
      <div class="no" dir="ltr">${escape(invoiceNumber(data.number))}</div>
      <span class="status">${escape(t(`accounts.invoice.status.${status}`))}</span>
    </div>
  </header>
  <section class="grid">
    <div><div class="label">${escape(t('accounts.invoice.billedTo'))}</div><p>${escape(data.clientName ?? t('accounts.noClient'))}</p>${data.clientPhone ? `<div dir="ltr" style="text-align:start">${escape(data.clientPhone)}</div>` : ''}</div>
    <div><div class="label">${escape(t('accounts.invoice.date'))}</div><p dir="ltr" style="text-align:start">${escape(data.issuedOn)}</p></div>
  </section>
  <table class="lines">
    <thead><tr><th class="label">${escape(t('accounts.invoice.description'))}</th><th class="label num" style="text-align:end">${escape(t('accounts.col.amount'))}</th></tr></thead>
    <tbody><tr><td>${escape(data.service || t('accounts.kind.income'))}${data.note ? `<div style="color:#666;font-size:13px">${escape(data.note)}</div>` : ''}<div dir="ltr" style="color:#666;font-size:13px;text-align:start">${escape(data.occurredOn)}</div></td><td dir="ltr" class="num">${escape(money(data.amountMinor))}</td></tr></tbody>
  </table>
  <table class="totals">
    ${row(t('accounts.invoice.total'), money(data.amountMinor))}
    ${row(t('accounts.owed.received'), money(data.paidMinor))}
    ${row(t('accounts.invoice.balance'), money(Math.max(0, left)), true)}
  </table>
  ${payments}
  <footer>${escape(t('accounts.invoice.thanks'))}</footer>
</main>
</body>
</html>
`;
}
