import type { Metadata } from 'next';
import Link from 'next/link';
import { addDays } from '@/server/domain/wholesale/forecast';
import { canWh } from '@/server/domain/wholesale/permissions';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { customersQuery, itemsQuery, warehousesQuery } from '@/server/wholesale/queries/catalog';
import { alertsQuery, dashboardQuery, expiryQuery } from '@/server/wholesale/queries/reports';
import { getStudioTranslator } from '@/studio/messages';
import { Alert } from '@/studio/ui';
import { LiveRefresh } from '../../_ui/LiveRefresh';
import { PageHeader } from '../../_ui/PageHeader';
import { SetupButton } from '../../_ui/PeopleForms';

export const metadata: Metadata = { title: 'Home' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;
const card = 'flex min-w-0 flex-col justify-center gap-1 rounded-md border border-line border-s-4 bg-raised px-4 py-3 hover:bg-hover';

/**
 * The first screen, built to fit one screen with no scrolling: the money in four tiles, what is owed in four more, the week
 * and what needs a look beside each other. Partners see how the company stands right now; a rep sees his own way in.
 */
export default async function HomePage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const isRep = actor!.role === 'REP';
  const [items, warehouses, customers] = await Promise.all([queryWh(itemsQuery), queryWh(warehousesQuery), queryWh(customersQuery)]);
  const needsSetup = !isRep && !warehouses.some((w) => w.kind === 'MAIN') && canWh(actor!.role, 'settings.manage');
  const board = canWh(actor!.role, 'report.view') && !needsSetup ? await queryWh(dashboardQuery) : null;
  const watch = board ? await queryWh(alertsQuery) : null;
  const expiry = board ? await queryWh(expiryQuery) : null;
  const expiring = (expiry?.rows ?? []).filter((r) => r.status !== 'ok');
  const counts: { label: string; value: number; href: string }[] = [
    { label: t('wh.home.items'), value: items.filter((i) => (i as { active?: boolean }).active !== false).length, href: '/wholesale/stock' },
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
  const today = baghdadDate();
  const byDay = new Map((board?.week ?? []).map((d) => [d.date, Number(d.iqd)]));
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, iqd: byDay.get(date) ?? 0 };
  });
  const maxDay = Math.max(1, ...week.map((d) => d.iqd));
  const owed = (m: Record<string, string>) =>
    Object.keys(m).length === 0 ? (
      <p className="text-md text-muted">0</p>
    ) : (
      Object.entries(m).map(([c, v]) => (
        <p key={c} className="truncate text-md font-semibold tabular-nums md:text-xl" dir="ltr">
          {money(v)} {c}
        </p>
      ))
    );
  const watchRows = [
    ...(watch?.alerts ?? []).map((a) => ({
      key: `a-${a.kind}-${a.saleId ?? a.customerId ?? a.customer}`,
      href: a.kind === 'overdueDebt' ? `/wholesale/customers/${a.customerId}` : a.saleId ? `/wholesale/sales/${a.saleId}` : '/wholesale/sales',
      text: t(`wh.alert.${a.kind}`, { ...a.params, name: a.customer || (a.itemNames ? nameOf(a.itemNames as Names, actor!.locale) : '') }),
      high: a.severity === 'high',
    })),
    ...(board?.lowStock ?? []).map((x) => ({ key: `l-${x.itemId}`, href: '/wholesale/stock', text: `${nameOf(x.names as Names, actor!.locale)} · ${money(x.qtyBase)} / ${money(x.reorderPoint)}`, high: false })),
  ];
  return (
    <>
      <PageHeader
        title={t('wh.home.hello', { name: actor!.name })}
        description={isRep ? t('wh.home.repHint') : undefined}
      />
      <div className="flex flex-col gap-3 px-4 pb-4 md:min-h-0 md:flex-1 md:px-6">
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
          <section aria-label={t('wh.home.needsYou')} className="flex flex-wrap gap-2">
            {attention.map((a) => (
              <Link key={a.href} href={a.href} className="flex items-center gap-2 rounded-md border border-wh-amber bg-wh-amber-wash px-3 py-1.5 hover:brightness-95">
                <span className="text-lg font-semibold tabular-nums text-wh-amber" dir="ltr">
                  {a.n}
                </span>
                <span className="text-sm font-medium">{a.label}</span>
              </Link>
            ))}
          </section>
        )}
        {board && (
          <>
            <section className="grid grid-cols-2 gap-3 md:min-h-0 md:flex-1 lg:grid-cols-3">
              <div className="col-span-2 flex flex-col justify-center gap-1 rounded-md border border-line border-s-4 border-s-wh-green bg-raised px-4 py-3">
                <p className="text-sm text-muted">{t('wh.home.cash')}</p>
                <div className="flex flex-wrap gap-x-8 gap-y-1">
                  {(['IQD', 'USD', 'IRT'] as const).map((c) => (
                    <div key={c}>
                      <p className="text-xs text-muted">{t(`wh.currency.${c}`)}</p>
                      <p className="text-xl font-semibold tabular-nums md:text-2xl" dir="ltr">
                        {money(board.cash[c] ?? '0')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <Link href="/wholesale/reports?tab=profit" className={`${card} border-s-wh-blue`}>
                <span className="text-sm text-muted">{t('wh.home.todaySales')}</span>
                <span className="text-xl font-semibold tabular-nums md:text-2xl" dir="ltr">
                  {money(board.todaySales.iqd)}
                </span>
                <span className="text-xs text-muted">
                  {board.todaySales.count} {t('wh.home.invoices')}
                </span>
              </Link>
              <Link href="/wholesale/reports?tab=profit" className={`${card} border-s-wh-violet`}>
                <span className="text-sm text-muted">{t('wh.home.monthProfit')}</span>
                <span className="text-xl font-semibold tabular-nums md:text-2xl" dir="ltr">
                  {money(board.monthProfit.netIqd)}
                </span>
                <span className="text-xs text-muted">IQD</span>
              </Link>
            </section>
            <section className="grid grid-cols-2 gap-3 md:min-h-0 md:flex-1 lg:grid-cols-4">
              <Link href="/wholesale/reports?tab=debts" className={`${card} border-s-wh-amber`}>
                <p className="text-sm text-muted">{t('wh.home.receivable')}</p>
                {owed(board.receivable)}
              </Link>
              <Link href="/wholesale/reports?tab=debts" className={`${card} border-s-wh-rose`}>
                <p className="text-sm text-muted">{t('wh.home.payable')}</p>
                {owed(board.payable)}
              </Link>
              <Link href="/wholesale/reports?tab=stock" className={`${card} border-s-wh-teal`}>
                <p className="text-sm text-muted">{t('wh.home.stockValue')}</p>
                <p className="truncate text-md font-semibold tabular-nums md:text-xl" dir="ltr">
                  {money(board.stockValueIqd)} IQD
                </p>
                {Object.entries(board.repCustody).map(([c, v]) => (
                  <p key={c} className="truncate text-xs text-muted">
                    {t('wh.home.withReps')}:{' '}
                    <span dir="ltr">
                      {money(v)} {c}
                    </span>
                  </p>
                ))}
              </Link>
              <div className="flex min-w-0 items-center justify-around gap-2 rounded-md border border-line border-s-4 border-s-wh-blue bg-raised px-3 py-3">
                {counts.map((c) => (
                  <Link key={c.href} href={c.href} className="flex min-w-0 flex-col items-center rounded-md px-2 py-1 hover:bg-hover">
                    <span className="text-xl font-semibold tabular-nums md:text-2xl" dir="ltr">
                      {c.value}
                    </span>
                    <span className="max-w-full truncate text-xs text-muted">{c.label}</span>
                  </Link>
                ))}
              </div>
            </section>
            <section className="grid gap-3 md:min-h-0 md:flex-[2] lg:grid-cols-4">
              <div className="flex flex-col rounded-md border border-line bg-raised px-4 py-3 lg:col-span-2">
                <h2 className="text-sm font-semibold">{t('wh.home.last7')}</h2>
                <ul className="mt-2 grid h-28 grid-cols-7 items-end gap-2 md:h-auto md:min-h-24 md:flex-1" dir="ltr">
                  {week.map((d) => (
                    <li key={d.date} className="flex h-full min-w-0 flex-col items-center justify-end gap-1" title={`${d.date}: ${money(String(d.iqd))}`}>
                      <span className="w-full max-w-10 rounded-sm bg-wh-blue" style={{ height: d.iqd > 0 ? `${Math.max(6, (d.iqd / maxDay) * 100)}%` : '3px', opacity: d.iqd > 0 ? 1 : 0.25 }} />
                      <span className="text-xs text-muted">{d.date.slice(5)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid min-h-0 gap-3 md:grid-rows-2">
              <div className="flex min-h-0 flex-col rounded-md border border-line border-s-4 border-s-wh-rose bg-raised px-4 py-3">
                <h2 className="text-sm font-semibold">{t('wh.expiry.title')}</h2>
                {expiring.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">{expiry && expiry.rows.length > 0 ? t('wh.home.allClear') : t('wh.expiry.none')}</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1 overflow-y-auto md:min-h-0 md:flex-1">
                    {expiring.map((r) => (
                      <li key={`${r.itemId}-${r.expiry}-${r.warehouse ?? ''}`}>
                        <Link href="/wholesale/stock" className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-hover ${r.status === 'expired' ? 'bg-danger-wash text-danger' : ''}`} title={`${r.expiry}`}>
                          <span className="truncate" dir="auto">{nameOf(r.names as Names, actor!.locale)}</span>
                          <span className="shrink-0 tabular-nums" dir="ltr">{r.status === 'expired' ? t('wh.expiry.expired') : t('wh.expiry.days', { n: r.daysLeft })}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex min-h-0 flex-col rounded-md border border-line bg-raised px-4 py-3">
                <h2 className="flex items-center justify-between gap-2 text-sm font-semibold">
                  {t('wh.alert.title')}
                  {canWh(actor!.role, 'ai.use') && (
                    <Link href="/wholesale/assistant" className="rounded-md border border-line-strong px-2 py-0.5 text-xs font-medium hover:bg-hover">
                      {t('wh.nav.assistant')}
                    </Link>
                  )}
                </h2>
                {watchRows.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">{t('wh.home.allClear')}</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1 overflow-y-auto md:min-h-0 md:flex-1">
                    {watchRows.map((r) => (
                      <li key={r.key}>
                        <Link href={r.href} className={`block truncate rounded-md px-2 py-1 text-sm hover:bg-hover ${r.high ? 'bg-danger-wash text-danger' : ''}`} dir="auto" title={r.text}>
                          {r.text}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
