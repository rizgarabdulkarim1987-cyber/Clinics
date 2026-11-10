'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { ACCOUNT_CURRENCIES, byClient, byMonth, byService, inPeriod, periodKey, summarize, type AccountCurrency, type Period } from '@/lib/accounts';
import type { AccountsBook } from '@/server/studio/queries/accounts';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { buttonClasses } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Select } from '@/studio/ui/Select';
import { MoneyStack } from './money';
import { RateHint } from './RateHint';
import { TotalsCard } from './TotalsCard';

const monthLabels = (locale: string, style: 'long' | 'short') =>
  Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ar-IQ', { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1))));

/**
 * The reports tab, built to fit one screen: a single toolbar line (period and Excel), then on a wide screen two columns
 * that share the height, so nothing scrolls the page. Left: the period's totals and the year's bars. Right: the clients
 * and the services ranking, each in its own card that scrolls inside itself only when there are more rows than room.
 */
export function ReportsTab({ book, today }: { book: AccountsBook; today: string }) {
  const t = useT();
  const { locale } = useLocale();
  const thisYear = Number(today.slice(0, 4));
  const [kind, setKind] = useState<Period['kind']>('month');
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(Number(today.slice(5, 7)));

  const years = [...new Set([thisYear, ...book.movements.map((row) => Number(row.occurredOn.slice(0, 4)))])].sort((a, b) => b - a);
  const period: Period = kind === 'all' ? { kind: 'all' } : kind === 'year' ? { kind: 'year', year } : { kind: 'month', year, month };
  const rows = inPeriod(book.movements, period);
  const rate = book.rate;
  const dollarsAndDinars = summarize(rows);
  const totals = summarize(rows, rate);
  const names = new Map(book.movements.flatMap((row) => (row.clientId && row.clientName ? [[row.clientId, row.clientName] as const] : [])));
  const byName = byClient(rows, names, rate);
  const services = byService(rows, rate);
  // With a rate the best client is the one with the best profit in all the money together.
  const clients = rate === null ? byName : [...byName].sort((a, b) => Number(a.clientId === null) - Number(b.clientId === null) || b.totals.IQD.net - a.totals.IQD.net);
  const sumsOfYear = byMonth(book.movements, year, rate);
  const yearCurrencies = ACCOUNT_CURRENCIES.filter((code) => sumsOfYear.some((entry) => entry[code].income !== 0 || entry[code].expense !== 0));
  const compact = numberFormat(locale, { notation: 'compact', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const short = monthLabels(locale, 'short');
  const long = monthLabels(locale, 'long');

  const toolbarSelect = 'w-auto min-w-28';

  return (
    <div className="flex flex-col gap-4 lg:grid lg:h-full lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-5 lg:gap-y-3">
      <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
        <Select aria-label={t('accounts.period.label')} className={toolbarSelect} value={kind} onChange={(e) => setKind(e.target.value as Period['kind'])} options={[{ value: 'month', label: t('accounts.period.kind.month') }, { value: 'year', label: t('accounts.period.kind.year') }, { value: 'all', label: t('accounts.period.kind.all') }]} />
        {kind !== 'all' && <Select aria-label={t('accounts.period.year')} className={toolbarSelect} value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={years.map((value) => ({ value: String(value), label: String(value) }))} />}
        {kind === 'month' && <Select aria-label={t('accounts.period.monthLabel')} className={toolbarSelect} value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} options={long.map((label, index) => ({ value: String(index + 1), label }))} />}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          <a href={`/agency/export?period=${encodeURIComponent(periodKey(period))}`} className={buttonClasses('secondary', 'md')} download title={t('accounts.export.note')}>
            <Download aria-hidden />
            {t('accounts.export')}
          </a>
          {kind !== 'all' && (
            <a href="/agency/export?period=all" className={buttonClasses('ghost', 'md')} download>
              <Download aria-hidden />
              {t('accounts.export.everything')}
            </a>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-3 lg:min-h-0">
        <TotalsCard totals={totals} footer={<RateHint totals={dollarsAndDinars} rate={rate} />} />

        <section aria-labelledby="chart-title" className="flex flex-col gap-2 lg:min-h-0 lg:flex-1">
          <h2 id="chart-title" className="text-md font-semibold">
            {t('accounts.chart.title', { year: String(year) })}
          </h2>
          {yearCurrencies.length === 0 && <p className="text-sm text-muted">{t('accounts.chart.empty', { year: String(year) })}</p>}
          <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
            {yearCurrencies.map((code: AccountCurrency) => {
              const peak = Math.max(1, ...sumsOfYear.flatMap((entry) => [entry[code].income, entry[code].expense]));
              return (
                <figure key={code} className="flex flex-col rounded-lg border border-line bg-raised px-4 py-3 lg:min-h-0 lg:flex-1" aria-label={`${t('accounts.chart.label')} · ${code}`}>
                  <figcaption className="mb-2 flex items-center justify-between text-sm text-muted">
                    <span dir="ltr">{code}</span>
                    <span className="flex gap-4">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="size-2.5 rounded-sm bg-ink" />
                        {t('accounts.chart.income')}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="size-2.5 rounded-sm bg-line-strong" />
                        {t('accounts.chart.expense')}
                      </span>
                    </span>
                  </figcaption>
                  <ol className="grid grid-cols-12 gap-1.5 lg:min-h-0 lg:flex-1 sm:gap-2" dir="ltr">
                    {sumsOfYear.map((entry, index) => {
                      const here = kind === 'month' && index + 1 === month;
                      return (
                        <li key={index} className={cx('flex flex-col items-center gap-1 rounded-sm px-0.5 pt-1 lg:min-h-0', here && 'bg-accent-wash')}>
                          <div className="flex h-24 w-full items-end justify-center gap-0.5 lg:h-auto lg:min-h-0 lg:flex-1" role="img" aria-label={`${long[index]}: ${t('accounts.summary.income')} ${entry[code].income}, ${t('accounts.summary.expense')} ${entry[code].expense}`}>
                            <span className="w-1/2 max-w-3 rounded-t-sm bg-ink" style={{ height: `${Math.max(entry[code].income ? 3 : 0, (entry[code].income / peak) * 100)}%` }} />
                            <span className="w-1/2 max-w-3 rounded-t-sm bg-line-strong" style={{ height: `${Math.max(entry[code].expense ? 3 : 0, (entry[code].expense / peak) * 100)}%` }} />
                          </div>
                          <span className="text-xs text-muted">{short[index]}</span>
                          <span className={cx('text-xs font-medium tabular-nums', entry[code].net > 0 && 'text-success', entry[code].net < 0 && 'text-danger', entry[code].net === 0 && 'text-muted')}>
                            {entry[code].net === 0 ? '·' : compact.format(code === 'IQD' ? entry[code].net : entry[code].net / 100)}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </figure>
              );
            })}
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:min-h-0 lg:grid-rows-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-3">
        <section aria-labelledby="clients-title" className="flex flex-col gap-2 lg:min-h-0">
          <h2 id="clients-title" className="text-md font-semibold">
            {t('accounts.clients.title')}
          </h2>
          {clients.length === 0 ? (
            <p className="text-sm text-muted">{t('accounts.clients.empty')}</p>
          ) : (
            <div className="rounded-lg border border-line bg-raised lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <table className="w-full border-collapse text-base">
                <thead className="sticky top-0 bg-raised">
                  <tr className="border-b border-line text-xs font-medium text-muted">
                    <th scope="col" className="h-9 px-4 text-start">
                      {t('accounts.col.client')}
                    </th>
                    <th scope="col" className="h-9 px-3 text-end">
                      {t('accounts.col.income')}
                    </th>
                    <th scope="col" className="h-9 px-4 text-end">
                      {t('accounts.col.net')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((row) => (
                    <tr key={row.clientId ?? 'none'} className="border-b border-line align-top hover:bg-surface">
                      <th scope="row" className={cx('px-4 py-2.5 text-start font-medium', row.clientId === null && 'text-muted')}>
                        {row.name ?? t('accounts.noClient')}
                        {row.clientId && (
                          <a href={`/agency/statement?client=${row.clientId}`} download className="ms-3 text-sm font-normal text-muted underline-offset-2 hover:text-text hover:underline">
                            {t('accounts.statement')}
                          </a>
                        )}
                      </th>
                      <td className="px-3 py-2.5 text-end">
                        <MoneyStack totals={row.totals} pick="income" locale={locale} />
                      </td>
                      <td className="px-4 py-2.5 text-end font-semibold">
                        <MoneyStack totals={row.totals} pick="net" locale={locale} tone="net" sign />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="services-title" className="flex flex-col gap-2 lg:min-h-0">
          <h2 id="services-title" className="text-md font-semibold">
            {t('accounts.services.title')}
          </h2>
          {services.length === 0 ? (
            <p className="text-sm text-muted">{t('accounts.services.empty')}</p>
          ) : (
            <ol className="divide-y divide-line rounded-lg border border-line bg-raised lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {services.map((row, index) => (
                <li key={row.service || 'none'} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5">
                  <span className="w-5 text-sm tabular-nums text-muted">{index + 1}</span>
                  <span className={cx('truncate font-medium', row.service === '' && 'text-muted')}>{row.service || t('accounts.services.none')}</span>
                  <span className="font-semibold">
                    <MoneyStack totals={row.totals} pick="income" locale={locale} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
