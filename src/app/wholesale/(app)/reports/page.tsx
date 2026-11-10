import { CalendarRange, Download, FileSpreadsheet, Package, Receipt, ShoppingBag, Store, TrendingUp, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { addDays } from '@/server/domain/wholesale/forecast';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { debtorsReportQuery, expensesReportQuery, forecastQuery, profitReportQuery, repAccountsQuery, salesBreakdownQuery, stockReportQuery } from '@/server/wholesale/queries/reports';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState } from '@/studio/ui';
import { PrintButton } from '../../_ui/PrintButton';
import { PageHeader } from '../../_ui/PageHeader';
import { RepAccounts } from '../../_ui/RepAccounts';
import { LiveRefresh } from '../../_ui/LiveRefresh';
import { Chip, Section, type Tone } from '../../_ui/Ui';

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
  const tab = sp.tab === 'stock' || sp.tab === 'debts' || sp.tab === 'reps' ? sp.tab : 'profit';
  const today = baghdadDate();
  const to = isoDate(sp.to, today);
  const from = isoDate(sp.from, `${today.slice(0, 7)}-01`);
  const tabs = [
    { key: 'profit', label: t('wh.reports.profit') },
    { key: 'stock', label: t('wh.reports.stock') },
    { key: 'debts', label: t('wh.reports.debts') },
    { key: 'reps', label: t('wh.reports.reps') },
  ];
  return (
    <>
      <PageHeader title={t('wh.reports.title')} description={`${t('wh.reports.description')} · ${from} → ${to}`} actions={<PrintButton label={t('wh.print.print')} />} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        <LiveRefresh seconds={60} />
        <nav aria-label={t('wh.reports.title')} className="flex gap-6 border-b border-line print:hidden">
          {tabs.map((x) => (
            <Link key={x.key} href={`/wholesale/reports?tab=${x.key}`} aria-current={tab === x.key ? 'page' : undefined} className={`-mb-px border-b-2 py-2 text-base ${tab === x.key ? 'border-ink font-semibold' : 'border-transparent text-muted hover:text-ink'}`}>
              {x.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-4 md:max-h-[calc(100dvh-12.5rem)] md:overflow-y-auto md:pe-1 print:max-h-none print:overflow-visible">
          {tab === 'profit' && <Profit from={from} to={to} t={t} locale={actor!.locale} />}
          {tab === 'stock' && <StockTab t={t} locale={actor!.locale} />}
          {tab === 'debts' && <Debts t={t} />}
          {tab === 'reps' && <RepAccounts reps={await queryWh(repAccountsQuery)} t={t} />}
        </div>
      </div>
    </>
  );
}

/** A ranked list: label and figure on one line, a thin bar under it showing the share of the largest. */
function Ranked({ rows }: { rows: { key: string; label: string; sub?: string; value: string; share: number }[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.map((r) => (
        <li key={r.key} className="py-2 first:pt-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-base" dir="auto">
              {r.label}
              {r.sub && <span className="text-sm text-muted"> · {r.sub}</span>}
            </span>
            <span className="shrink-0 text-base font-semibold tabular-nums" dir="ltr">
              {r.value}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover">
            <div className="h-full rounded-full bg-wh-blue" style={{ width: `${Math.max(3, Math.round(r.share * 100))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
const share = (v: number, max: number) => (max > 0 ? v / max : 0);
const iqdOf = (by: Record<string, string>) => Number(by.IQD ?? Object.values(by)[0] ?? 0);

function Kpi({ icon, tone, label, value, negative }: { icon: typeof Wallet; tone: Tone; label: string; value: string; negative?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-3 shadow-[0_1px_2px_rgb(15_42_74/0.06)]">
      <Chip icon={icon} tone={tone} size="size-11" />
      <div className="min-w-0">
        <div className="text-sm leading-tight text-muted">{label}</div>
        <div className={`truncate text-xl font-semibold tabular-nums ${negative ? 'text-wh-rose' : ''}`} dir="ltr">
          {value}
        </div>
      </div>
    </div>
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
  const expensesTotal = Number(p.grossIqd) + Number(p.fxIqd) - Number(p.netIqd);
  const maxDay = Math.max(0, ...days.map((d) => Number(d.iqd)));
  const maxCustomer = Math.max(0, ...sales.customers.map((c) => iqdOf(c.byCurrency)));
  const maxItem = Math.max(0, ...sales.items.map((c) => iqdOf(c.byCurrency)));
  const maxExpense = Math.max(0, ...expenses.map((e) => iqdOf(e.byCurrency)));
  return (
    <>
      <form className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-raised p-3 print:hidden" method="get">
        <input type="hidden" name="tab" value="profit" />
        <Chip icon={CalendarRange} tone="blue" />
        <label className="flex flex-col gap-0.5 text-sm text-muted">
          {t('wh.reports.from')}
          <input name="from" type="date" defaultValue={from} className="rounded-md border border-line bg-bg px-3 py-1.5 text-base text-ink" dir="ltr" />
        </label>
        <label className="flex flex-col gap-0.5 text-sm text-muted">
          {t('wh.reports.to')}
          <input name="to" type="date" defaultValue={to} className="rounded-md border border-line bg-bg px-3 py-1.5 text-base text-ink" dir="ltr" />
        </label>
        <button className="min-h-10 rounded-md bg-ink px-4 text-base font-semibold text-white" type="submit">
          {t('wh.reports.show')}
        </button>
        <Link className="min-h-10 content-center rounded-md border border-line-strong px-3 text-base hover:bg-hover" href={`/wholesale/reports?tab=profit&from=${addDays(to, -29)}&to=${to}`}>
          {t('wh.reports.last30')}
        </Link>
        <span className="ms-auto text-sm text-muted">{t('wh.reports.inIqd')}</span>
      </form>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={TrendingUp} tone="blue" label={t('wh.reports.sales')} value={money(p.salesIqd)} />
        <Kpi icon={ShoppingBag} tone="green" label={t('wh.reports.gross')} value={money(p.grossIqd)} negative={Number(p.grossIqd) < 0} />
        <Kpi icon={Receipt} tone="amber" label={t('wh.reports.byExpense')} value={money(String(expensesTotal))} />
        <Kpi icon={Wallet} tone="violet" label={t('wh.reports.net')} value={money(p.netIqd)} negative={Number(p.netIqd) < 0} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section icon={Wallet} tone="violet" title={t('wh.reports.net')}>
          <dl className="flex flex-col">
            {rows.map((r, i) => (
              <div key={i} className={`flex items-baseline justify-between gap-3 py-1.5 ${r.strong ? 'mt-1 border-t border-line pt-2.5 font-semibold' : ''}`}>
                <dt className={r.strong ? 'text-md' : 'text-base text-muted'}>{r.label}</dt>
                <span aria-hidden className="mb-1 min-w-4 flex-1 self-end border-b border-dotted border-line-strong" />
                <dd className={`tabular-nums ${r.strong ? 'text-md' : 'text-base'} ${Number(r.value) < 0 || r.value.startsWith('-') ? 'text-wh-rose' : ''}`} dir="ltr">
                  {money(r.value)}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section icon={CalendarRange} tone="blue" title={t('wh.reports.byDay')}>
          {days.length === 0 ? <EmptyState title={t('wh.home.noSales')} /> : <Ranked rows={days.map((d) => ({ key: d.date, label: d.date, sub: String(d.count), value: money(d.iqd), share: share(Number(d.iqd), maxDay) }))} />}
        </Section>
        <Section icon={Store} tone="teal" title={t('wh.reports.byCustomer')}>
          {sales.customers.length === 0 ? <EmptyState title={t('wh.home.noSales')} /> : <Ranked rows={sales.customers.map((c, i) => ({ key: String(i), label: c.name, sub: String(c.count), value: cur(c.byCurrency), share: share(iqdOf(c.byCurrency), maxCustomer) }))} />}
        </Section>
        <Section icon={Package} tone="green" title={t('wh.reports.byItem')}>
          {sales.items.length === 0 ? (
            <EmptyState title={t('wh.home.noSales')} />
          ) : (
            <Ranked rows={sales.items.map((c, i) => ({ key: String(i), label: nameOf(c.names as Names, locale), sub: `${money(c.qty)} ${t(`wh.unit.${c.baseUnit}`)}`, value: cur(c.byCurrency), share: share(iqdOf(c.byCurrency), maxItem) }))} />
          )}
        </Section>
        <Section icon={Receipt} tone="amber" title={t('wh.reports.byExpense')}>
          {expenses.length === 0 ? <EmptyState title={t('wh.reports.noExpenses')} /> : <Ranked rows={expenses.map((e) => ({ key: e.category, label: t(`wh.expenses.cat.${e.category}`), value: cur(e.byCurrency), share: share(iqdOf(e.byCurrency), maxExpense) }))} />}
        </Section>
      </div>
      <section className="flex flex-wrap items-center gap-2 text-base print:hidden">
        <span className="text-muted">{t('wh.reports.download')} (Excel)</span>
        <a className="inline-flex min-h-10 items-center gap-2 rounded-md bg-wh-green px-3 font-semibold text-white" href={`/wholesale/export?kind=all&from=${from}&to=${to}`} download>
          <FileSpreadsheet aria-hidden className="size-4" />
          {t('wh.reports.x.all')}
        </a>
        {(['sales-all', 'purchases-all', 'sales-customers', 'sales-items', 'expenses', 'stock', 'debts'] as const).map((k) => (
          <a key={k} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line-strong px-3 hover:bg-hover" href={`/wholesale/export?kind=${k}&from=${from}&to=${to}`} download>
            <Download aria-hidden className="size-4 text-muted" />
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
