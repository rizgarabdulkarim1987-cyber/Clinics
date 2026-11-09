'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { ACCOUNT_CURRENCIES, byClient, byMonth, inPeriod, periodKey, summarize, type AccountCurrency, type Period } from '@/lib/accounts';
import type { AccountsBook } from '@/server/studio/queries/accounts';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { buttonClasses } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { Select } from '@/studio/ui/Select';
import { Money, MoneyStack, usedCurrencies } from './money';

const monthLabels = (locale: string, style: 'long' | 'short') =>
  Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ar-IQ', { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1))));

/** The reports tab: a period, its totals, each month of the year, each client, and the Excel file of what is shown. */
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
  const totals = summarize(rows);
  const names = new Map(book.movements.flatMap((row) => (row.clientId && row.clientName ? [[row.clientId, row.clientName] as const] : [])));
  const clients = byClient(rows, names);
  const sumsOfYear = byMonth(book.movements, year);
  const yearCurrencies = ACCOUNT_CURRENCIES.filter((code) => sumsOfYear.some((entry) => entry[code].income !== 0 || entry[code].expense !== 0));
  const compact = numberFormat(locale, { notation: 'compact', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const short = monthLabels(locale, 'short');
  const long = monthLabels(locale, 'long');

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="reports-title" className="flex flex-col gap-4">
        <div>
          <h2 id="reports-title" className="text-lg font-semibold">
            {t('accounts.reports.title')}
          </h2>
          <p className="text-base text-muted">{t('accounts.reports.description')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('accounts.period.label')}>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as Period['kind'])}
              options={[
                { value: 'month', label: t('accounts.period.kind.month') },
                { value: 'year', label: t('accounts.period.kind.year') },
                { value: 'all', label: t('accounts.period.kind.all') },
              ]}
            />
          </Field>
          {kind !== 'all' && (
            <Field label={t('accounts.period.year')}>
              <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={years.map((value) => ({ value: String(value), label: String(value) }))} />
            </Field>
          )}
          {kind === 'month' && (
            <Field label={t('accounts.period.monthLabel')}>
              <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} options={long.map((label, index) => ({ value: String(index + 1), label }))} />
            </Field>
          )}
          <a href={`/agency/export?period=${encodeURIComponent(periodKey(period))}`} className={buttonClasses('secondary', 'md', 'self-end')} download>
            <Download aria-hidden />
            {t('accounts.export')}
          </a>
        </div>
        <p className="text-sm text-muted">{t('accounts.export.note')}</p>

        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-raised">
          {usedCurrencies(totals).map((code) => (
            <dl key={code} className="grid grid-cols-1 items-center gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[1fr_1fr_1.2fr] sm:px-5">
              <div>
                <dt className="text-sm text-muted">{t('accounts.summary.income')}</dt>
                <dd className="text-xl font-semibold">
                  <Money minor={totals[code].income} currency={code} locale={locale} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t('accounts.summary.expense')}</dt>
                <dd className="text-xl font-semibold">
                  <Money minor={totals[code].expense} currency={code} locale={locale} />
                </dd>
              </div>
              <div className={cx('rounded-md px-3 py-2', totals[code].net < 0 ? 'bg-danger-wash' : 'bg-success-wash')}>
                <dt className="text-sm text-muted">{t('accounts.summary.net')}</dt>
                <dd className="text-xl font-semibold">
                  <Money minor={totals[code].net} currency={code} locale={locale} tone="net" sign />
                </dd>
              </div>
            </dl>
          ))}
        </div>
      </section>

      <section aria-labelledby="chart-title" className="flex flex-col gap-3">
        <h2 id="chart-title" className="text-md font-semibold">
          {t('accounts.chart.title', { year: String(year) })}
        </h2>
        {yearCurrencies.length === 0 && <p className="text-sm text-muted">{t('accounts.chart.empty', { year: String(year) })}</p>}
        {yearCurrencies.map((code: AccountCurrency) => {
          const peak = Math.max(1, ...sumsOfYear.flatMap((entry) => [entry[code].income, entry[code].expense]));
          return (
            <figure key={code} className="rounded-lg border border-line bg-raised p-4" aria-label={`${t('accounts.chart.label')} · ${code}`}>
              <figcaption className="mb-3 flex items-center justify-between text-sm text-muted">
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
              <ol className="grid grid-cols-12 gap-1.5 sm:gap-2" dir="ltr">
                {sumsOfYear.map((entry, index) => {
                  const here = kind === 'month' && index + 1 === month;
                  return (
                    <li key={index} className={cx('flex flex-col items-center gap-1 rounded-sm px-0.5 pt-1', here && 'bg-accent-wash')}>
                      <div className="flex h-28 w-full items-end justify-center gap-0.5" role="img" aria-label={`${long[index]}: ${t('accounts.summary.income')} ${entry[code].income}, ${t('accounts.summary.expense')} ${entry[code].expense}`}>
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
      </section>

      <section aria-labelledby="clients-title" className="flex flex-col gap-3">
        <h2 id="clients-title" className="text-md font-semibold">
          {t('accounts.clients.title')}
        </h2>
        {clients.length === 0 ? (
          <p className="text-sm text-muted">{t('accounts.clients.empty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-raised">
            <table className="w-full border-collapse text-base">
              <thead>
                <tr className="border-b border-line text-xs font-medium text-muted">
                  <th scope="col" className="h-9 px-4 text-start">
                    {t('accounts.col.client')}
                  </th>
                  <th scope="col" className="h-9 px-3 text-end">
                    {t('accounts.col.income')}
                  </th>
                  <th scope="col" className="h-9 px-3 text-end">
                    {t('accounts.col.expense')}
                  </th>
                  <th scope="col" className="h-9 px-4 text-end">
                    {t('accounts.col.net')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {clients.map((row) => (
                  <tr key={row.clientId ?? 'none'} className="border-b border-line align-top last:border-b-0 hover:bg-surface">
                    <th scope="row" className={cx('px-4 py-3 text-start font-medium', row.clientId === null && 'text-muted')}>
                      {row.name ?? t('accounts.noClient')}
                    </th>
                    <td className="px-3 py-3 text-end">
                      <MoneyStack totals={row.totals} pick="income" locale={locale} />
                    </td>
                    <td className="px-3 py-3 text-end">
                      <MoneyStack totals={row.totals} pick="expense" locale={locale} />
                    </td>
                    <td className="px-4 py-3 text-end font-semibold">
                      <MoneyStack totals={row.totals} pick="net" locale={locale} tone="net" sign />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface font-semibold">
                  <th scope="row" className="px-4 py-3 text-start">
                    {t('accounts.clients.total')}
                  </th>
                  <td className="px-3 py-3 text-end">
                    <MoneyStack totals={totals} pick="income" locale={locale} />
                  </td>
                  <td className="px-3 py-3 text-end">
                    <MoneyStack totals={totals} pick="expense" locale={locale} />
                  </td>
                  <td className="px-4 py-3 text-end">
                    <MoneyStack totals={totals} pick="net" locale={locale} tone="net" sign />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
