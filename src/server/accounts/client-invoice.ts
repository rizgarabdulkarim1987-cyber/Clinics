import { ACCOUNT_CURRENCIES, parsePeriod, type AccountCurrency } from '@/lib/accounts';
import type { Locale } from '@/lib/locale';
import type { Translate } from '@/lib/i18n';
import type { ClientInvoiceData } from '@/server/studio/queries/accounts';
import { escapeHtml as esc, formatInvoiceMoney, INVOICE_STYLE } from './invoice';

/**
 * One invoice for a whole client over a period: each service (website, social media, anything else) is a line, the
 * payments received are listed under them with their dates and details, and the totals are worked out per currency:
 * dinars and dollars are never added together.
 */

function periodText(key: string, t: Translate, locale: Locale): string {
  const period = parsePeriod(key);
  if (!period || period.kind === 'all') return t('accounts.period.kind.all');
  if (period.kind === 'year') return String(period.year);
  const month = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ar-IQ', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(period.year, period.month - 1, 1)));
  return `${month} ${period.year}`;
}

export function renderClientInvoicePage(data: ClientInvoiceData, t: Translate, locale: Locale, links: { clientId: string; period: string }): string {
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const base = `client=${encodeURIComponent(links.clientId)}&amp;period=${encodeURIComponent(links.period)}`;
  const switcher = (['ar', 'ckb', 'en'] as const)
    .map((code) => `<a href="/agency/invoice?${base}&amp;lang=${code}"${code === locale ? ' aria-current="true"' : ''}>${code === 'en' ? 'English' : code === 'ar' ? 'العربية' : 'کوردی'}</a>`)
    .join('');

  const sums: Record<AccountCurrency, { total: number; paid: number; period: number }> = { IQD: { total: 0, paid: 0, period: 0 }, USD: { total: 0, paid: 0, period: 0 } };
  for (const line of data.lines) {
    sums[line.currency].total += line.amountMinor;
    sums[line.currency].paid += line.paidMinor;
    sums[line.currency].period += line.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  }
  const used = ACCOUNT_CURRENCIES.filter((code) => sums[code].total > 0);
  const owedAny = used.some((code) => sums[code].total - sums[code].paid > 0);
  const paidAny = used.some((code) => sums[code].paid > 0);
  const status = !owedAny ? 'paid' : paidAny ? 'part' : 'unpaid';

  const lines = data.lines
    .map(
      (line) =>
        `<tr><td>${esc(line.service || t('accounts.kind.income'))}${line.note ? `<div class="sub">${esc(line.note)}</div>` : ''}<div dir="ltr" class="sub" style="text-align:start">${esc(line.occurredOn)}</div></td><td dir="ltr" class="num">${esc(formatInvoiceMoney(line.amountMinor, line.currency))}</td></tr>`,
    )
    .join('');

  const totals = used
    .map((code) => {
      const { total, paid, period } = sums[code];
      const money = (minor: number) => esc(formatInvoiceMoney(minor, code));
      return `<table class="totals"><tr><th scope="row">${esc(t('accounts.invoice.total'))} (${code})</th><td dir="ltr">${money(total)}</td></tr><tr><th scope="row">${esc(t('accounts.owed.received'))}</th><td dir="ltr">${money(period)}</td></tr><tr class="strong"><th scope="row">${esc(t('accounts.invoice.balance'))}</th><td dir="ltr">${money(Math.max(0, total - paid))}</td></tr></table>`;
    })
    .join('');

  const payments = data.lines
    .flatMap((line) => line.payments.map((payment) => ({ ...payment, currency: line.currency, service: line.service })))
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const paymentRows = payments.length
    ? `<h2>${esc(t('accounts.invoice.payments'))}</h2><table class="lines">${payments
        .map((payment) => `<tr><td><span dir="ltr">${esc(payment.paidOn)}</span> · ${esc(payment.service || t('accounts.kind.income'))}${payment.note ? `<div class="sub">${esc(payment.note)}</div>` : ''}</td><td dir="ltr" class="num">${esc(formatInvoiceMoney(payment.amountMinor, payment.currency))}</td></tr>`)
        .join('')}</table>`
    : '';

  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(`${t('accounts.invoice.title')} - ${data.clientName}`)}</title>
<style>${INVOICE_STYLE}</style>
</head>
<body>
<div class="bar"><nav aria-label="Language">${switcher}</nav><button type="button" onclick="window.print()">${esc(t('accounts.invoice.print'))}</button></div>
<main class="sheet">
  <header>
    <img src="/agency/logo.webp" alt="Buzzify" width="96" height="96">
    <div class="meta">
      <h1>${esc(t('accounts.invoice.title'))}</h1>
      <div class="no">${esc(periodText(links.period, t, locale))}</div>
      <span class="status">${esc(t(`accounts.invoice.status.${status}`))}</span>
    </div>
  </header>
  <section class="grid">
    <div><div class="label">${esc(t('accounts.invoice.billedTo'))}</div><p>${esc(data.clientName)}</p>${data.clientPhone ? `<div dir="ltr" style="text-align:start">${esc(data.clientPhone)}</div>` : ''}</div>
    <div><div class="label">${esc(t('accounts.invoice.date'))}</div><p dir="ltr" style="text-align:start">${esc(data.issuedOn)}</p></div>
  </section>
  <table class="lines">
    <thead><tr><th class="label">${esc(t('accounts.invoice.description'))}</th><th class="label num" style="text-align:end">${esc(t('accounts.col.amount'))}</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  ${totals}
  ${paymentRows}
  <footer>${esc(t('accounts.invoice.thanks'))}</footer>
</main>
</body>
</html>
`;
}
