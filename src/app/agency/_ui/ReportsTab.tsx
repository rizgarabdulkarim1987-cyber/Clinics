'use client';

import { Download, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { ACCOUNT_CURRENCIES, byClient, byMonth, byService, inPeriod, periodKey, summarize, type AccountCurrency, type Period } from '@/lib/accounts';
import type { AccountsBook } from '@/server/studio/queries/accounts';
import { useLocale, useT } from '@/studio/i18n';
import { buttonClasses } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Select } from '@/studio/ui/Select';
import { formatBook, Money, MoneyStack } from './money';
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
  const [chartCurrency, setChartCurrency] = useState<AccountCurrency>('IQD');
  const [focusMonth, setFocusMonth] = useState<number | null>(null);

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
  const serviceCharts: { basis: AccountCurrency; show: AccountCurrency[] }[] =
    rate === null
      ? ACCOUNT_CURRENCIES.filter((code) => services.some((row) => row.totals[code].income > 0)).map((code) => ({ basis: code, show: [code] }))
      : services.some((row) => row.totals.IQD.income > 0)
        ? [{ basis: 'IQD', show: ['IQD', 'USD'] }]
        : [];
  const long = monthLabels(locale, 'long');
  // One chart for the year, one currency at a time; the readout under the title follows the hovered month.
  const chartCode = yearCurrencies.includes(chartCurrency) ? chartCurrency : (yearCurrencies[0] ?? 'IQD');
  const peak = Math.max(1, ...sumsOfYear.flatMap((entry) => [entry[chartCode].income, entry[chartCode].expense]));
  const lastWithMoney = sumsOfYear.findLastIndex((entry) => entry[chartCode].income !== 0 || entry[chartCode].expense !== 0);
  const focusIndex = focusMonth ?? (kind === 'month' ? month - 1 : Math.max(0, lastWithMoney));
  const focused = sumsOfYear[focusIndex]![chartCode];

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

      <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
        <TotalsCard totals={totals} footer={<RateHint totals={dollarsAndDinars} rate={rate} />} />

        <section aria-labelledby="chart-title" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="chart-title" className="text-md font-semibold">
              {t('accounts.chart.title', { year: String(year) })}
            </h2>
            {yearCurrencies.length > 1 && (
              <div role="group" aria-label={t('accounts.chart.label')} dir="ltr" className="inline-flex rounded-md border border-line bg-surface p-0.5">
                {yearCurrencies.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={value === chartCode}
                    onClick={() => setChartCurrency(value)}
                    className={cx('min-h-8 rounded-sm px-3 text-sm font-medium transition-colors duration-150', value === chartCode ? 'bg-ink text-on-ink' : 'text-muted hover:text-text')}
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
          </div>
          {yearCurrencies.length === 0 && <p className="text-sm text-muted">{t('accounts.chart.empty', { year: String(year) })}</p>}
          {yearCurrencies.length > 0 && (
            <figure className="flex flex-col gap-3 rounded-lg border border-line bg-raised px-4 py-3" aria-label={`${t('accounts.chart.label')} · ${chartCode}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                <span className="font-medium">{long[focusIndex]}</span>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <span aria-hidden className="size-2.5 rounded-sm bg-ink" />
                    {t('accounts.chart.income')} <Money minor={focused.income} currency={chartCode} locale={locale} className="font-medium text-text" />
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <span aria-hidden className="size-2.5 rounded-sm bg-line-strong" />
                    {t('accounts.chart.expense')} <Money minor={focused.expense} currency={chartCode} locale={locale} className="font-medium text-text" />
                  </span>
                  <Money minor={focused.net} currency={chartCode} locale={locale} tone="net" sign className="font-semibold" />
                </span>
              </div>
              <ol className="grid grid-cols-12 gap-1 border-b border-line sm:gap-1.5" dir="ltr">
                {sumsOfYear.map((entry, index) => (
                  <li key={index} className="min-w-0">
                    <button
                      type="button"
                      onMouseEnter={() => setFocusMonth(index)}
                      onFocus={() => setFocusMonth(index)}
                      onClick={() => setFocusMonth(index)}
                      aria-label={`${long[index]}: ${t('accounts.summary.income')} ${formatBook(entry[chartCode].income, chartCode)}, ${t('accounts.summary.expense')} ${formatBook(entry[chartCode].expense, chartCode)}`}
                      aria-current={index === focusIndex ? 'true' : undefined}
                      className={cx('group flex w-full flex-col items-center gap-1 rounded-sm px-0.5 pt-1 transition-colors duration-150', index === focusIndex ? 'bg-accent-wash' : 'hover:bg-surface')}
                    >
                      <span className="flex h-24 w-full items-end justify-center gap-0.5">
                        <span className="w-1/2 max-w-3 rounded-t-sm bg-ink" style={{ height: `${Math.max(entry[chartCode].income ? 3 : 0, (entry[chartCode].income / peak) * 100)}%` }} />
                        <span className="w-1/2 max-w-3 rounded-t-sm bg-line-strong" style={{ height: `${Math.max(entry[chartCode].expense ? 3 : 0, (entry[chartCode].expense / peak) * 100)}%` }} />
                      </span>
                      <span className={cx('pb-1 text-xs tabular-nums', index === focusIndex ? 'font-semibold text-text' : 'text-muted')}>{index + 1}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </figure>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:min-h-0 lg:grid-rows-[minmax(0,1fr)_auto] lg:gap-3">
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
                    <th scope="col" className="w-10 p-0">
                      <span className="sr-only">{t('accounts.statement')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((row) => (
                    <tr key={row.clientId ?? 'none'} className="border-b border-line align-top hover:bg-surface">
                      <th scope="row" className={cx('px-4 py-2.5 text-start font-medium', row.clientId === null && 'text-muted')}>
                        {row.name ?? t('accounts.noClient')}
                      </th>
                      <td className="px-3 py-2.5 text-end">
                        <MoneyStack totals={row.totals} pick="income" locale={locale} />
                      </td>
                      <td className="px-4 py-2.5 text-end font-semibold">
                        <MoneyStack totals={row.totals} pick="net" locale={locale} tone="net" sign />
                      </td>
                      <td className="w-10 ps-0 pe-3 py-1.5 text-end">
                        {row.clientId && (
                          <a
                            href={`/agency/statement?client=${row.clientId}`}
                            download
                            aria-label={`${t('accounts.statement')}: ${row.name ?? ''}`}
                            title={t('accounts.statement')}
                            className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface hover:text-text"
                          >
                            <FileSpreadsheet aria-hidden className="size-4" />
                          </a>
                        )}
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
            <div className="flex flex-col gap-3 lg:max-h-72 lg:min-h-0 lg:overflow-y-auto">
              {serviceCharts.map((chart) => {
                const peak = Math.max(1, ...services.map((row) => row.totals[chart.basis].income));
                return (
                  <figure key={chart.basis} className="rounded-lg border border-line bg-raised px-4 py-3" aria-label={`${t('accounts.services.title')} · ${chart.basis}`}>
                    <figcaption className="mb-1 text-sm text-muted" dir="ltr">
                      {chart.basis}
                    </figcaption>
                    <ol className="flex flex-col">
                      {services.filter((row) => row.totals[chart.basis].income > 0).map((row) => (
                        <li key={row.service || 'none'} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 py-1.5">
                          <span className={cx('truncate text-sm font-medium', row.service === '' && 'text-muted')}>{row.service || t('accounts.services.none')}</span>
                          <span aria-hidden className="h-2.5 rounded-full bg-line" dir="ltr">
                            <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.max(3, (row.totals[chart.basis].income / peak) * 100)}%` }} />
                          </span>
                          <span className="text-sm font-semibold">
                            {chart.show.map((code, index) => (
                              <span key={code}>
                                {index > 0 && <span className="px-1 text-muted">·</span>}
                                <Money minor={row.totals[code].income} currency={code} locale={locale} />
                              </span>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </figure>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
