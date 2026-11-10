import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import type { QuoteData } from '@/server/studio/queries/accounts';
import { quoteNumber, quoteState } from './quote-format';
import { escapeHtml as esc, formatInvoiceMoney, INVOICE_STYLE } from './invoice';

/** One quote as a printable page: what is offered, for how much, and until when. The browser's Print makes the PDF. */
export function renderQuotePage(data: QuoteData, t: Translate, locale: Locale, today: string): string {
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const state = quoteState(data, today);
  const switcher = (['ar', 'ckb', 'en'] as const)
    .map((code) => `<a href="/agency/quote?id=${encodeURIComponent(data.id)}&amp;lang=${code}"${code === locale ? ' aria-current="true"' : ''}>${code === 'en' ? 'English' : code === 'ar' ? 'العربية' : 'کوردی'}</a>`)
    .join('');
  const total = formatInvoiceMoney(data.amountMinor, data.currency);

  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(`${quoteNumber(data.number)} - ${data.clientName}`)}</title>
<style>${INVOICE_STYLE}</style>
</head>
<body>
<div class="bar"><nav aria-label="Language">${switcher}</nav><button type="button" onclick="window.print()">${esc(t('accounts.invoice.print'))}</button></div>
<main class="sheet">
  <header>
    <img src="/agency/logo.webp" alt="Buzzify" width="96" height="96">
    <div class="meta">
      <h1>${esc(t('accounts.quote.title'))}</h1>
      <div class="no" dir="ltr">${esc(quoteNumber(data.number))}</div>
      <span class="status">${esc(t(`accounts.quote.state.${state}`))}</span>
    </div>
  </header>
  <section class="grid">
    <div><div class="label">${esc(t('accounts.quote.preparedFor'))}</div><p>${esc(data.clientName)}</p>${data.clientPhone ? `<div dir="ltr" style="text-align:start">${esc(data.clientPhone)}</div>` : ''}</div>
    <div><div class="label">${esc(t('accounts.invoice.date'))}</div><p dir="ltr" style="text-align:start">${esc(data.issuedOn)}</p><div class="label" style="margin-top:10px">${esc(t('accounts.quote.validUntil'))}</div><p dir="ltr" style="text-align:start">${esc(data.validUntil)}</p></div>
  </section>
  <table class="lines">
    <thead><tr><th class="label">${esc(t('accounts.invoice.description'))}</th><th class="label num" style="text-align:end">${esc(t('accounts.col.amount'))}</th></tr></thead>
    <tbody><tr><td>${esc(data.service)}${data.note ? `<div class="sub" style="color:#666;font-size:13px">${esc(data.note)}</div>` : ''}</td><td class="num" dir="ltr">${esc(total)}</td></tr></tbody>
  </table>
  <table class="totals"><tr class="strong"><th scope="row">${esc(t('accounts.invoice.total'))}</th><td dir="ltr">${esc(total)}</td></tr></table>
  <footer>${esc(t('accounts.quote.thanks'))}</footer>
</main>
</body>
</html>`;
}

export { quoteNumber, quoteState };
