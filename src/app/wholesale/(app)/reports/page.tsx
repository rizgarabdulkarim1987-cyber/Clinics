import type { Metadata } from 'next';
import Link from 'next/link';
import { addDays } from '@/server/domain/wholesale/forecast';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { debtorsReportQuery, expensesReportQuery, forecastQuery, profitReportQuery, salesBreakdownQuery, stockReportQuery } from '@/server/wholesale/queries/reports';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, PageHeader } from '@/studio/ui';
import { LiveRefresh } from '../../_ui/LiveRefresh';

export const metadata: Metadata = { title: 'Reports' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;
const minus = (v: string) => (Number(v) === 0 ? '0' : `-${v}`);
const isoDate = (v: unknown, fallback: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
type T = ReturnType<typeof getStudioTranslator>;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string }> }) {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const sp = await searchParams;
  const tab = sp.tab === 'stock' || sp.tab === 'debts' ? sp.tab : 'profit';
  const today = baghdadDate();
  const to = isoDate(sp.to, today);
  const from = isoDate(sp.from, `${today.slice(0, 7)}-01`);
  const tabs = [
    { key: 'profit', label: t('wh.reports.profit') },
    { key: 'stock', label: t('wh.reports.stock') },
    { key: 'debts', label: t('wh.reports.debts') },
  ];
  return (
    <>
      <PageHeader title={t('wh.reports.title')} description={t('wh.reports.description')} />
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        <LiveRefresh seconds={60} />
        <nav aria-label={t('wh.reports.title')} className="flex gap-6 border-b border-line">
          {tabs.map((x) => (
            <Link key={x.key} href={`/wholesale/reports?tab=${x.key}`} aria-current={tab === x.key ? 'page' : undefined} className={`-mb-px border-b-2 py-2 text-base ${tab === x.key ? 'border-ink font-semibold' : 'border-transparent text-muted hover:text-ink'}`}>
              {x.label}
            </Link>
          ))}
        </nav>
        {tab === 'profit' && <Profit from={from} to={to} t={t} locale={actor!.locale} />}
        {tab === 'stock' && <StockTab t={t} locale={actor!.locale} />}
        {tab === 'debts' && <Debts t={t} />}
      </div>
    </>
  );
}

const cur = (by: Record<string, string>) =>
  Object.entries(by)
    .map(([c, v]) => `${money(v)} ${c}`)
    .join(' · ');

async function Profit({ from, to, t, locale }: { from: string; to: string; t: T; locale: string }) {
  const [{ profit: p, days }, sales, expenses] = await Promise.all([queryWh(profitReportQuery, { from, to }), queryWh(salesBreakdownQuery, { from, to }), queryWh(expensesReportQuery, { from, to })]);
  const rows: { label: string; value: string; strong?: boolean }[] = [
    { label: t('wh.reports.sales'), value: p.salesIqd },
    { label: t('wh.reports.discounts'), value: minus(p.discountsIqd) },
    { label: t('wh.reports.cogs'), value: minus(p.cogsIqd) },
    { label: t('wh.reports.gross'), value: p.grossIqd, strong: true },
    { label: t('wh.reports.fx'), value: p.fxIqd },
    ...p.expenseLines.map((l) => ({ label: t(`wh.reports.acct.${l.code}`), value: minus(l.iqd) })),
    { label: t('wh.reports.net'), value: p.netIqd, strong: true },
  ];
  return (
    <>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="tab" value="profit" />
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t('wh.reports.from')}
          <input name="from" type="date" defaultValue={from} className="rounded-md border border-line bg-raised px-3 py-2 text-base text-ink" dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t('wh.reports.to')}
          <input name="to" type="date" defaultValue={to} className="rounded-md border border-line bg-raised px-3 py-2 text-base text-ink" dir="ltr" />
        </label>
        <button className="rounded-md border border-line bg-raised px-4 py-2 text-base hover:bg-hover" type="submit">
          {t('wh.reports.show')}
        </button>
        <Link className="text-sm text-muted underline" href={`/wholesale/reports?tab=profit&from=${addDays(to, -29)}&to=${to}`}>
          {t('wh.reports.last30')}
        </Link>
      </form>
      <section className="rounded-md border border-line bg-raised p-4">
        <p className="mb-3 text-sm text-muted">{t('wh.reports.inIqd')}</p>
        <dl className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className={`flex items-center justify-between gap-3 ${r.strong ? 'border-t border-line pt-2 font-semibold' : ''}`}>
              <dt className="text-base">{r.label}</dt>
              <dd className="tabular-nums" dir="ltr">
                {money(r.value)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-md border border-line bg-raised p-4">
        <h2 className="mb-3 text-md font-semibold">{t('wh.reports.byDay')}</h2>
        {days.length === 0 ? (
          <EmptyState title={t('wh.home.noSales')} />
        ) : (
          <ul className="flex flex-col gap-1">
            {days.map((d) => (
              <li key={d.date} className="flex items-center justify-between gap-3 text-base">
                <span className="tabular-nums" dir="ltr">
                  {d.date}
                </span>
                <span className="text-sm text-muted">{d.count}</span>
                <span className="tabular-nums" dir="ltr">
                  {money(d.iqd)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-md border border-line bg-raised p-4">
        <h2 className="mb-3 text-md font-semibold">{t('wh.reports.byCustomer')}</h2>
        {sales.customers.length === 0 ? (
          <EmptyState title={t('wh.home.noSales')} />
        ) : (
          <ul className="flex flex-col gap-1">
            {sales.customers.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span className="min-w-0 truncate" dir="auto">
                  {c.name} <span className="text-sm text-muted">· {c.count}</span>
                </span>
                <span className="tabular-nums" dir="ltr">
                  {cur(c.byCurrency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-md border border-line bg-raised p-4">
        <h2 className="mb-3 text-md font-semibold">{t('wh.reports.byItem')}</h2>
        {sales.items.length === 0 ? (
          <EmptyState title={t('wh.home.noSales')} />
        ) : (
          <ul className="flex flex-col gap-1">
            {sales.items.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span className="min-w-0 truncate" dir="auto">
                  {nameOf(c.names as Names, locale)} <span className="text-sm text-muted">· {money(c.qty)} {t(`wh.unit.${c.baseUnit}`)}</span>
                </span>
                <span className="tabular-nums" dir="ltr">
                  {cur(c.byCurrency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-md border border-line bg-raised p-4">
        <h2 className="mb-3 text-md font-semibold">{t('wh.reports.byExpense')}</h2>
        {expenses.length === 0 ? (
          <EmptyState title={t('wh.reports.noExpenses')} />
        ) : (
          <ul className="flex flex-col gap-1">
            {expenses.map((e) => (
              <li key={e.category} className="flex items-center justify-between gap-3 text-base">
                <span>{t(`wh.expenses.cat.${e.category}`)}</span>
                <span className="tabular-nums" dir="ltr">
                  {cur(e.byCurrency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-wrap items-center gap-3 text-base">
        <span className="text-muted">{t('wh.reports.download')}</span>
        {(['sales-customers', 'sales-items', 'expenses', 'stock', 'debts'] as const).map((k) => (
          <a key={k} className="rounded-md border border-line-strong px-3 py-2 hover:bg-hover" href={`/wholesale/export?kind=${k}&from=${from}&to=${to}`} download>
            {t(`wh.reports.x.${k}`)}
          </a>
        ))}
      </section>
    </>
  );
}

async function StockTab({ t, locale }: { t: T; locale: string }) {
  const [s, f] = await Promise.all([queryWh(stockReportQuery), queryWh(forecastQuery)]);
  if (s.rows.length === 0) return <EmptyState title={t('wh.reports.noStock')} />;
  return (
    <>
    <section className="rounded-md border border-line bg-raised p-4">
      <h2 className="text-md font-semibold">{t('wh.forecast.title')}</h2>
      <p className="mb-3 text-sm text-muted">{t('wh.forecast.hint', { days: String(f.window), lead: String(f.leadDays) })}</p>
      <ul className="flex flex-col gap-2">
        {f.rows.map((r) => (
          <li key={r.itemId} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2 first:border-0 first:pt-0">
            <span className="text-base" dir="auto">
              {nameOf(r.names as Names, locale)} <span className="text-sm text-muted">· {r.code}</span>
            </span>
            <span className="flex items-center gap-3 tabular-nums" dir="ltr">
              <span className="text-sm text-muted">{money(r.onHand)} {t(`wh.unit.${r.baseUnit}`)}</span>
              {r.coverDays === null ? (
                <span className="rounded-full bg-hover px-2.5 py-0.5 text-sm">{t('wh.forecast.noSales')}</span>
              ) : (
                <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${r.coverDays < f.leadDays ? 'bg-danger-wash text-danger' : 'bg-success-wash text-success'}`}>
                  {r.coverDays} {t('wh.forecast.days')}
                </span>
              )}
              {r.reorderBy && r.coverDays !== null && r.coverDays < f.leadDays * 2 && <span className="text-sm text-muted">{t('wh.forecast.orderBy')} {r.reorderBy}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
    <section className="rounded-md border border-line bg-raised p-4">
      <p className="mb-3 text-md font-semibold">
        {t('wh.home.stockValue')}:{' '}
        <span className="tabular-nums" dir="ltr">
          {money(s.totalIqd)} IQD
        </span>
      </p>
      <ul className="flex flex-col gap-2">
        {s.rows.map((r) => (
          <li key={`${r.itemId}-${r.warehouseId}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2 first:border-0 first:pt-0">
            <span className="text-base">
              {nameOf(r.names as Names, locale)}{' '}
              <span className="text-sm text-muted">
                {r.code} · {r.warehouse}
              </span>
            </span>
            <span className="tabular-nums" dir="ltr">
              {money(r.qtyBase)} · {money(r.valueIqd)} IQD
            </span>
          </li>
        ))}
      </ul>
    </section>
    </>
  );
}

async function Debts({ t }: { t: T }) {
  const d = await queryWh(debtorsReportQuery);
  const block = (title: string, rows: typeof d.customers) => (
    <section className="rounded-md border border-line bg-raised p-4">
      <h2 className="mb-3 text-md font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-base text-muted">{t('wh.reports.noDebts')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.partyId} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2 first:border-0 first:pt-0">
              <span className="text-base">{r.name}</span>
              <span className="tabular-nums" dir="ltr">
                {Object.entries(r.balances)
                  .map(([c, v]) => `${money(v)} ${c}`)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <>
      {block(t('wh.home.receivable'), d.customers)}
      {block(t('wh.home.payable'), d.suppliers)}
    </>
  );
}
