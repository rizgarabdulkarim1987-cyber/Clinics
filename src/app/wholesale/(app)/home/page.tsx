import type { Metadata } from 'next';
import Link from 'next/link';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { customersQuery, itemsQuery, warehousesQuery } from '@/server/wholesale/queries/catalog';
import { alertsQuery, dashboardQuery } from '@/server/wholesale/queries/reports';
import { getStudioTranslator } from '@/studio/messages';
import { Alert, PageHeader } from '@/studio/ui';
import { LiveRefresh } from '../../_ui/LiveRefresh';
import { SetupButton } from '../../_ui/PeopleForms';

export const metadata: Metadata = { title: 'Home' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;
const card = 'flex flex-col justify-between gap-1 rounded-md border border-line bg-raised p-4 hover:bg-hover';

/** The first screen. Partners see how the company stands right now; a rep sees his own warehouse's way in. */
export default async function HomePage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const isRep = actor!.role === 'REP';
  const [items, warehouses, customers] = await Promise.all([queryWh(itemsQuery), queryWh(warehousesQuery), queryWh(customersQuery)]);
  const needsSetup = !isRep && !warehouses.some((w) => w.kind === 'MAIN') && canWh(actor!.role, 'settings.manage');
  const board = canWh(actor!.role, 'report.view') && !needsSetup ? await queryWh(dashboardQuery) : null;
  const watch = board ? await queryWh(alertsQuery) : null;
  const tiles: { label: string; value: number; href: string }[] = [
    { label: t('wh.home.items'), value: items.length, href: '/wholesale/catalog' },
    { label: t('wh.home.warehouses'), value: warehouses.length, href: '/wholesale/stock' },
    { label: t('wh.home.customers'), value: customers.length, href: '/wholesale/customers' },
  ];
  const attention = board
    ? [
        { n: board.pending.sales, label: t('wh.home.pendingSales'), href: '/wholesale/sales' },
        { n: board.pending.handovers, label: t('wh.home.pendingHandovers'), href: '/wholesale/treasury' },
        { n: board.pending.expenses, label: t('wh.home.pendingExpenses'), href: '/wholesale/expenses' },
      ].filter((a) => a.n > 0)
    : [];
  const maxDay = board ? Math.max(1, ...board.week.map((d) => Number(d.iqd))) : 1;
  return (
    <>
      <PageHeader title={t('wh.home.hello', { name: actor!.name })} description={isRep ? t('wh.home.repHint') : undefined} />
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        <LiveRefresh />
        {needsSetup && (
          <Alert tone="neutral">
            <strong>{t('wh.home.setup')}</strong> {t('wh.home.setupBody')}
            <div className="mt-3">
              <SetupButton />
            </div>
          </Alert>
        )}
        {attention.length > 0 && (
          <section aria-label={t('wh.home.needsYou')} className="flex flex-wrap gap-3">
            {attention.map((a) => (
              <Link key={a.href} href={a.href} className="flex items-center gap-3 rounded-md border border-line bg-raised px-4 py-3 hover:bg-hover">
                <span className="text-2xl font-semibold tabular-nums" dir="ltr">
                  {a.n}
                </span>
                <span className="text-base">{a.label}</span>
              </Link>
            ))}
          </section>
        )}
        {watch && watch.alerts.length > 0 && (
          <section aria-label={t('wh.alert.title')} className="flex flex-col gap-2 rounded-md border border-line bg-raised p-4">
            <h2 className="text-md font-semibold">{t('wh.alert.title')}</h2>
            <ul className="flex flex-col gap-2">
              {watch.alerts.map((a, i) => (
                <li key={i}>
                  <Link
                    href={a.kind === 'overdueDebt' ? `/wholesale/customers/${a.customerId}` : a.saleId ? `/wholesale/sales/${a.saleId}` : '/wholesale/sales'}
                    className={`flex items-start gap-3 rounded-md border px-3 py-2 text-base hover:bg-hover ${a.severity === 'high' ? 'border-danger bg-danger-wash' : 'border-line'}`}
                  >
                    <span dir="auto">
                      {t(`wh.alert.${a.kind}`, { ...a.params, name: a.customer || (a.itemNames ? nameOf(a.itemNames as Names, actor!.locale) : '') })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {board && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-2 rounded-md border border-line bg-raised p-4 lg:col-span-2">
                <p className="text-sm text-muted">{t('wh.home.cash')}</p>
                <div className="flex flex-wrap gap-x-8 gap-y-1">
                  {(['IQD', 'USD', 'IRT'] as const).map((c) => (
                    <div key={c}>
                      <p className="text-sm text-muted">{t(`wh.currency.${c}`)}</p>
                      <p className="text-xl font-semibold tabular-nums" dir="ltr">
                        {money(board.cash[c] ?? '0')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <Link href="/wholesale/reports?tab=profit" className={card}>
                <span className="text-sm text-muted">{t('wh.home.todaySales')}</span>
                <span className="text-xl font-semibold tabular-nums" dir="ltr">
                  {money(board.todaySales.iqd)}
                </span>
                <span className="text-sm text-muted">
                  {board.todaySales.count} {t('wh.home.invoices')}
                </span>
              </Link>
              <Link href="/wholesale/reports?tab=profit" className={card}>
                <span className="text-sm text-muted">{t('wh.home.monthProfit')}</span>
                <span className="text-xl font-semibold tabular-nums" dir="ltr">
                  {money(board.monthProfit.netIqd)}
                </span>
                <span className="text-sm text-muted">IQD</span>
              </Link>
            </section>
            <section className="grid gap-3 sm:grid-cols-3">
              <Link href="/wholesale/reports?tab=debts" className={card}>
                <p className="text-sm text-muted">{t('wh.home.receivable')}</p>
                {Object.entries(board.receivable).map(([c, v]) => (
                  <p key={c} className="text-md font-semibold tabular-nums" dir="ltr">
                    {money(v)} {c}
                  </p>
                ))}
                {Object.keys(board.receivable).length === 0 && <p className="text-md text-muted">0</p>}
              </Link>
              <Link href="/wholesale/reports?tab=debts" className={card}>
                <p className="text-sm text-muted">{t('wh.home.payable')}</p>
                {Object.entries(board.payable).map(([c, v]) => (
                  <p key={c} className="text-md font-semibold tabular-nums" dir="ltr">
                    {money(v)} {c}
                  </p>
                ))}
                {Object.keys(board.payable).length === 0 && <p className="text-md text-muted">0</p>}
              </Link>
              <Link href="/wholesale/reports?tab=stock" className={card}>
                <p className="text-sm text-muted">{t('wh.home.stockValue')}</p>
                <p className="text-md font-semibold tabular-nums" dir="ltr">
                  {money(board.stockValueIqd)} IQD
                </p>
                {Object.entries(board.repCustody).map(([c, v]) => (
                  <p key={c} className="text-sm text-muted">
                    {t('wh.home.withReps')}:{' '}
                    <span dir="ltr">
                      {money(v)} {c}
                    </span>
                  </p>
                ))}
              </Link>
            </section>
            <section className="rounded-md border border-line bg-raised p-4">
              <h2 className="mb-3 text-md font-semibold">{t('wh.home.last7')}</h2>
              {board.week.length === 0 ? (
                <p className="text-sm text-muted">{t('wh.home.noSales')}</p>
              ) : (
                <ul className="flex h-28 items-end gap-2" dir="ltr">
                  {board.week.map((d) => (
                    <li key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.date}: ${money(d.iqd)}`}>
                      <span className="w-full rounded-sm bg-ink" style={{ height: `${Math.max(4, (Number(d.iqd) / maxDay) * 80)}px` }} />
                      <span className="text-xs text-muted">{d.date.slice(5)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {board.lowStock.length > 0 && (
              <section className="rounded-md border border-line bg-raised p-4">
                <h2 className="mb-3 text-md font-semibold">{t('wh.home.lowStock')}</h2>
                <ul className="flex flex-col gap-2">
                  {board.lowStock.map((x) => (
                    <li key={x.itemId} className="flex items-center justify-between gap-3 text-base">
                      <span>
                        {nameOf(x.names as Names, actor!.locale)} <span className="text-sm text-muted">{x.code}</span>
                      </span>
                      <span className="tabular-nums" dir="ltr">
                        {money(x.qtyBase)} / {money(x.reorderPoint)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <ul className="grid gap-3 sm:grid-cols-3">
          {tiles.map((tile) => (
            <li key={tile.href}>
              <Link href={tile.href} className="flex min-h-24 flex-col justify-between rounded-md border border-line bg-raised p-4 hover:bg-hover">
                <span className="text-sm text-muted">{tile.label}</span>
                <span className="text-2xl font-semibold tabular-nums" dir="ltr">
                  {tile.value}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
