import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Banknote, Target, BarChart3, Boxes, CalendarClock, CalendarDays, HandCoins, Receipt, TrendingUp, Truck, Wallet, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { addDays } from '@/server/domain/wholesale/forecast';
import { canWh } from '@/server/domain/wholesale/permissions';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { customersQuery, itemsQuery, warehousesQuery } from '@/server/wholesale/queries/catalog';
import { alertsQuery, dashboardQuery, expiryQuery, sellInfoQuery } from '@/server/wholesale/queries/reports';
import { debtsListQuery, salesQuery } from '@/server/wholesale/queries/sale';
import { repTargetsQuery } from '@/server/wholesale/queries/targets';
import { getStudioTranslator } from '@/studio/messages';
import { Alert } from '@/studio/ui';
import { LiveRefresh } from '../../_ui/LiveRefresh';
import { PageHeader } from '../../_ui/PageHeader';
import { SetupButton } from '../../_ui/PeopleForms';
import { TargetBars } from '../../_ui/TargetBars';

export const metadata: Metadata = { title: 'Home' };

const money = (v: string | number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;
const TONES = {
  blue: 'bg-wh-blue-wash text-wh-blue',
  green: 'bg-wh-green-wash text-wh-green',
  amber: 'bg-wh-amber-wash text-wh-amber',
  rose: 'bg-wh-rose-wash text-wh-rose',
  violet: 'bg-wh-violet-wash text-wh-violet',
  teal: 'bg-wh-teal-wash text-wh-teal',
} as const;
type Tone = keyof typeof TONES;
const Chip = ({ icon: Icon, tone, size = 'size-8' }: { icon: LucideIcon; tone: Tone; size?: string }) => (
  <span className={`grid shrink-0 place-items-center rounded-full ${size} ${TONES[tone]}`}>
    <Icon aria-hidden className="size-4" />
  </span>
);
const shadow = 'shadow-[0_1px_2px_rgb(15_42_74/0.06)]';

/** One cell of the connected figures bar. */
function Stat({ label, href, sub, icon, tone, children }: { label: string; href?: string; sub?: ReactNode; icon: LucideIcon; tone: Tone; children: ReactNode }) {
  const body = (
    <>
      <Chip icon={icon} tone={tone} />
      <span className="flex min-w-0 flex-col">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-base font-bold leading-tight tabular-nums text-wh-rail 2xl:text-lg [overflow-wrap:anywhere]" dir="ltr">
          {children}
        </span>
        {sub && <span className="truncate text-xs text-muted">{sub}</span>}
      </span>
    </>
  );
  const cls = 'flex min-w-0 items-center gap-2.5 px-3.5 py-2';
  return href ? (
    <Link href={href} className={`${cls} hover:bg-hover`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A framed block with its title and an optional link to the full list. */
function Block({ title, icon, tone, href, more, children }: { title: string; icon: LucideIcon; tone: Tone; href?: string; more?: string; children: ReactNode }) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col rounded-lg border border-line bg-raised ${shadow}`}>
      <h2 className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3.5 py-1.5 text-base font-semibold">
        <span className="flex items-center gap-2">
          <Chip icon={icon} tone={tone} size="size-6" />
          {title}
        </span>
        {href && more && (
          <Link href={href} className="inline-flex h-7 items-center rounded-md border border-line-strong bg-raised px-2.5 text-sm font-medium text-text hover:bg-wh-blue hover:text-white">
            {more}
          </Link>
        )}
      </h2>
      {children}
    </section>
  );
}

const rowCls = 'flex items-center justify-between gap-3 px-3.5 py-1.5 text-sm hover:bg-hover';

/**
 * The first screen: the figures that matter in one connected bar (money today, the month, cash, what is owed to us and by us,
 * the stock), then the week beside what needs a look, then the three lists a manager opens every morning (latest sales, who owes
 * and by when, what is about to expire). A rep sees the same shape with his own numbers.
 */
export default async function HomePage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const locale = actor!.locale;
  const isRep = actor!.role === 'REP';
  const [items, warehouses, customers] = await Promise.all([queryWh(itemsQuery), queryWh(warehousesQuery), queryWh(customersQuery)]);
  const needsSetup = !isRep && !warehouses.some((w) => w.kind === 'MAIN') && canWh(actor!.role, 'settings.manage');
  const board = canWh(actor!.role, 'report.view') && !needsSetup ? await queryWh(dashboardQuery) : null;
  const ok = !needsSetup;
  const [watch, expiry, sales, debts, mine, goals] = await Promise.all([
    board ? queryWh(alertsQuery).catch(() => null) : Promise.resolve(null),
    ok ? queryWh(expiryQuery).catch(() => null) : Promise.resolve(null),
    ok ? queryWh(salesQuery).catch(() => null) : Promise.resolve(null),
    ok ? queryWh(debtsListQuery).catch(() => null) : Promise.resolve(null),
    ok && !board ? queryWh(sellInfoQuery).catch(() => null) : Promise.resolve(null),
    ok ? queryWh(repTargetsQuery).catch(() => null) : Promise.resolve(null),
  ]);
  const today = baghdadDate();
  const expiring = (expiry?.rows ?? []).filter((r) => r.status !== 'ok');
  const soldToday = (sales ?? []).filter((x) => x.status === 'POSTED' && x.date === today);
  const repToday: Record<string, number> = {};
  for (const x of soldToday) repToday[x.currency] = (repToday[x.currency] ?? 0) + Number(x.totalFinal);
  const activeItems = items.filter((i) => (i as { active?: boolean }).active !== false).length;

  const byDay = new Map((board?.week ?? []).map((d) => [d.date, Number(d.iqd)]));
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, iqd: byDay.get(date) ?? 0 };
  });
  const maxDay = Math.max(1, ...week.map((d) => d.iqd));
  const weekTotal = week.reduce((s, d) => s + d.iqd, 0);
  const months = (board?.months ?? []).map((m) => ({ month: m.month, iqd: Number(m.iqd) }));
  const maxMonth = Math.max(1, ...months.map((m) => m.iqd));
  const yearTotal = months.reduce((s, m) => s + m.iqd, 0);

  const owed = (m: Record<string, string>) => (Object.keys(m).length === 0 ? '0' : Object.entries(m).map(([c, v]) => `${money(v)} ${c}`).join(' · '));
  const cash = (m: Record<string, string> | null | undefined) => {
    const parts = (['IQD', 'USD', 'IRT'] as const).filter((c) => Number(m?.[c] ?? 0) !== 0).map((c) => `${money(m![c]!)} ${c}`);
    return parts.length ? parts.join(' · ') : '0';
  };

  const need = [
    ...(board
      ? [
          { key: 'ps', n: board.pending.sales, text: t('wh.home.pendingSales'), href: '/wholesale/sales', high: false },
          { key: 'ph', n: board.pending.handovers, text: t('wh.home.pendingHandovers'), href: '/wholesale/treasury', high: false },
          { key: 'pe', n: board.pending.expenses, text: t('wh.home.pendingExpenses'), href: '/wholesale/expenses', high: false },
        ].filter((x) => x.n > 0)
      : []),
    ...(watch?.alerts ?? []).map((a) => ({
      key: `a-${a.kind}-${a.saleId ?? a.customerId ?? a.customer}`,
      n: 0,
      href: a.kind === 'overdueDebt' ? `/wholesale/customers/${a.customerId}` : a.saleId ? `/wholesale/sales/${a.saleId}` : '/wholesale/sales',
      text: t(`wh.alert.${a.kind}`, { ...a.params, name: a.customer || (a.itemNames ? nameOf(a.itemNames as Names, locale) : '') }),
      high: a.severity === 'high',
    })),
    ...(board?.lowStock ?? []).map((x) => ({ key: `l-${x.itemId}`, n: 0, href: '/wholesale/stock', text: `${nameOf(x.names as Names, locale)} · ${money(x.qtyBase)} / ${money(x.reorderPoint)}`, high: false })),
  ].slice(0, 7);

  const lateDays = (due: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);

  return (
    <>
      <PageHeader title={t('wh.home.hello', { name: actor!.name })} description={isRep ? t('wh.home.repHint') : today} />
      <div className="flex flex-col gap-2.5 px-4 pb-3 md:px-6">
        <LiveRefresh />
        {needsSetup && (
          <Alert tone="neutral">
            <strong>{t('wh.home.setup')}</strong> {t('wh.home.setupBody')}
            <div className="mt-3">
              <SetupButton />
            </div>
          </Alert>
        )}

        {ok && (
          <div className={`grid grid-cols-2 divide-line overflow-hidden rounded-lg border border-line bg-raised md:grid-cols-3 xl:grid-cols-6 [&>*]:border-b [&>*]:border-line xl:[&>*]:border-b-0 xl:[&>*:not(:first-child)]:border-s ${shadow}`}>
            {board ? (
              <>
                <Stat icon={Receipt} tone="blue" label={t('wh.home.todaySales')} href="/wholesale/reports?tab=profit" sub={`${board.todaySales.count} ${t('wh.home.invoices')}`}>
                  {money(board.todaySales.iqd)} IQD
                </Stat>
                <Stat icon={TrendingUp} tone="green" label={t('wh.home.monthProfit')} href="/wholesale/reports?tab=profit">
                  {money(board.monthProfit.netIqd)} IQD
                </Stat>
                <Stat icon={Banknote} tone="teal" label={t('wh.home.cash')} href="/wholesale/treasury">
                  {cash(board.cash)}
                </Stat>
                <Stat icon={HandCoins} tone="amber" label={t('wh.home.receivable')} href="/wholesale/reports?tab=debts">
                  {owed(board.receivable)}
                </Stat>
                <Stat icon={Truck} tone="rose" label={t('wh.home.payable')} href="/wholesale/reports?tab=debts">
                  {owed(board.payable)}
                </Stat>
                <Stat
                  icon={Boxes}
                  tone="violet"
                  label={t('wh.home.stockValue')}
                  href="/wholesale/reports?tab=stock"
                  sub={`${activeItems} ${t('wh.home.items')} · ${customers.length} ${t('wh.home.customers')}`}
                >
                  {money(board.stockValueIqd)} IQD
                </Stat>
              </>
            ) : (
              <>
                <Stat icon={Receipt} tone="blue" label={t('wh.sw.salesToday')} sub={t('wh.sw.invoicesN', { n: soldToday.length })}>
                  {Object.keys(repToday).length ? Object.entries(repToday).map(([c, v]) => `${money(v)} ${c}`).join(' · ') : '0'}
                </Stat>
                <Stat icon={Wallet} tone="teal" label={t('wh.sw.cashTill')} href="/wholesale/treasury">
                  {cash(mine?.cash)}
                </Stat>
                <Stat icon={HandCoins} tone="amber" label={t('wh.sw.debts')} sub={t('wh.sw.debtsN', { n: debts?.rows.length ?? 0 })} href="/wholesale/sales">
                  {debts?.rows.length ?? 0}
                </Stat>
                <Stat icon={CalendarClock} tone="rose" label={t('wh.expiry.title')} href="/wholesale/stock" sub={mine?.next ? `${nameOf(mine.next.names as Names, locale)} · ${t('wh.expiry.days', { n: mine.next.days })}` : undefined}>
                  {(mine?.expired ?? 0) + (mine?.soon ?? 0)}
                </Stat>
              </>
            )}
          </div>
        )}

        {board && (
          <div className="grid gap-2.5 xl:grid-cols-3">
            <Block icon={BarChart3} tone="blue" title={t('wh.home.last7')}>
              <div className="flex flex-col gap-1 px-3.5 pb-2 pt-1.5">
                <p className="flex items-baseline gap-2 text-sm text-muted">
                  <span className="text-lg font-bold tabular-nums text-wh-rail" dir="ltr">
                    {money(weekTotal)} IQD
                  </span>
                </p>
                <div className="relative h-28" dir="ltr">
                  <div aria-hidden className="absolute inset-0 flex flex-col justify-between pb-5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="border-t border-dashed border-line" />
                    ))}
                  </div>
                  <ul className="relative grid h-full grid-cols-7 items-end gap-3">
                    {week.map((d, i) => {
                      const last = i === week.length - 1;
                      return (
                        <li key={d.date} className="flex h-full min-w-0 flex-col items-center justify-end gap-1" title={`${d.date}: ${money(d.iqd)}`}>
                          <span className="text-xs font-semibold tabular-nums text-muted">{d.iqd > 0 ? compact(d.iqd) : ''}</span>
                          <span className={`w-full max-w-12 rounded-t ${last ? 'bg-wh-blue' : 'bg-wh-blue/35'}`} style={{ height: d.iqd > 0 ? `${Math.max(4, (d.iqd / maxDay) * 78)}%` : '2px', opacity: d.iqd > 0 ? 1 : 0.3 }} />
                          <span className={`text-xs ${last ? 'font-semibold text-text' : 'text-muted'}`}>{d.date.slice(5)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </Block>
            <Block icon={CalendarDays} tone="violet" title={t('wh.home.last12')}>
              <div className="flex flex-col gap-1 px-3.5 pb-2 pt-1.5">
                <p className="text-lg font-bold tabular-nums text-wh-rail" dir="ltr">
                  {money(yearTotal)} IQD
                </p>
                <div className="relative h-28" dir="ltr">
                  <div aria-hidden className="absolute inset-0 flex flex-col justify-between pb-5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="border-t border-dashed border-line" />
                    ))}
                  </div>
                  <ul className="relative grid h-full grid-cols-12 items-end gap-1.5">
                    {months.map((m, i) => {
                      const last = i === months.length - 1;
                      return (
                        <li key={m.month} className="flex h-full min-w-0 flex-col items-center justify-end gap-1" title={`${m.month}: ${money(m.iqd)}`}>
                          <span className={`w-full rounded-t ${last ? 'bg-wh-blue' : 'bg-wh-blue/35'}`} style={{ height: m.iqd > 0 ? `${Math.max(4, (m.iqd / maxMonth) * 82)}%` : '2px', opacity: m.iqd > 0 ? 1 : 0.3 }} />
                          <span className={`text-[10px] ${last ? 'font-semibold text-text' : 'text-muted'}`}>{m.month.slice(5)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </Block>
            <Block icon={AlertTriangle} tone="amber" title={t('wh.home.needsYou')} href={canWh(actor!.role, 'ai.use') ? '/wholesale/assistant' : undefined} more={t('wh.nav.assistant')}>
              {need.length === 0 ? (
                <p className="px-4 py-4 text-center text-sm text-muted">{t('wh.home.allClear')}</p>
              ) : (
                <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
                  {need.map((r) => (
                    <li key={r.key}>
                      <Link href={r.href} className={rowCls} title={r.text}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span aria-hidden className={`size-2 shrink-0 rounded-full ${r.high ? 'bg-wh-rose' : 'bg-wh-amber'}`} />
                          <span className="truncate" dir="auto">
                            {r.text}
                          </span>
                        </span>
                        {r.n > 0 && (
                          <span className="shrink-0 rounded-full bg-wh-amber px-2 py-0.5 text-xs font-bold tabular-nums text-white" dir="ltr">
                            {r.n}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </div>
        )}

        {ok && goals && goals.reps.length > 0 && (
          <Block icon={Target} tone="violet" title={`${t('wh.target.title')} · ${goals.month.split('-').reverse().join('/')}`} href={canWh(actor!.role, 'staff.manage') ? '/wholesale/targets' : undefined} more={t('wh.target.setLink')}>
            <div className={`grid gap-x-6 gap-y-4 px-3.5 py-3 ${goals.reps.length > 1 ? 'lg:grid-cols-2 xl:grid-cols-3' : ''}`}>
              {goals.reps.map((r) => (
                <div key={r.userId} className="flex min-w-0 flex-col gap-2">
                  <p className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                    <span className="truncate" dir="auto">
                      {r.name}
                    </span>
                    <span className="shrink-0 text-xs font-normal text-muted">{t('wh.target.dayOf', { n: goals.progress })}</span>
                  </p>
                  <TargetBars row={r} pace={goals.progress} t={t} locale={locale} wide={goals.reps.length === 1} />
                </div>
              ))}
            </div>
          </Block>
        )}

        {ok && (
          <div className="grid gap-2.5 lg:grid-cols-3">
            <Block icon={Receipt} tone="green" title={t('wh.home.recent')} href="/wholesale/sales" more={t('wh.home.all')}>
              {(sales ?? []).length === 0 ? (
                <p className="px-4 py-4 text-center text-sm text-muted">{t('wh.sw.noRecent')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {(sales ?? []).slice(0, 6).map((x) => (
                    <li key={x.id}>
                      <Link href={`/wholesale/sales/${x.id}`} className={rowCls}>
                        <span className="min-w-0">
                          <span className="block truncate font-medium" dir="auto">
                            #{x.number} · {x.customer.name}
                          </span>
                          <span className="flex items-center gap-1.5 text-xs text-muted" dir="ltr">
                            <span aria-hidden className={`size-1.5 rounded-full ${x.paymentMode === 'CREDIT' ? 'bg-wh-amber' : 'bg-wh-green'}`} />
                            {x.date}
                            {x.status !== 'POSTED' ? ` · ${t(`wh.sales.status.${x.status}`)}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums" dir="ltr">
                          {money(x.totalFinal)} {x.currency}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            <Block icon={HandCoins} tone="amber" title={t('wh.sw.debts')} href="/wholesale/sales" more={t('wh.home.all')}>
              {(debts?.rows ?? []).length === 0 ? (
                <p className="px-4 py-4 text-center text-sm text-muted">{t('wh.sw.debtsNone')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {(debts?.rows ?? []).slice(0, 6).map((d) => (
                    <li key={d.id}>
                      <Link href={`/wholesale/sales?c=${d.id}`} className={rowCls}>
                        <span className="min-w-0">
                          <span className="block truncate font-medium" dir="auto">
                            {d.name}
                          </span>
                          <span className={`text-xs ${d.overdue ? 'font-semibold text-wh-rose' : 'text-muted'}`}>
                            {d.overdue && d.due ? t('wh.sw.overdueDays', { n: lateDays(d.due) }) : d.due ? t('wh.sw.dueOn', { d: d.due }) : t('wh.sw.noDue')}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums" dir="ltr">
                          {Object.entries(d.totals).map(([c, v]) => `${money(v)} ${c}`).join(' · ')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            <Block icon={CalendarClock} tone="rose" title={t('wh.expiry.title')} href="/wholesale/stock" more={t('wh.home.all')}>
              {expiring.length === 0 ? (
                <p className="px-4 py-4 text-center text-sm text-muted">{expiry && expiry.rows.length > 0 ? t('wh.home.allClear') : t('wh.expiry.none')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {expiring.slice(0, 6).map((r) => (
                    <li key={`${r.itemId}-${r.expiry}-${r.warehouse ?? ''}`}>
                      <Link href="/wholesale/stock" className={rowCls} title={r.expiry}>
                        <span className="truncate font-medium" dir="auto">
                          {nameOf(r.names as Names, locale)}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${r.status === 'expired' ? 'bg-wh-rose-wash text-wh-rose' : 'bg-wh-amber-wash text-wh-amber'}`}>
                          {r.status === 'expired' ? t('wh.expiry.expired') : t('wh.expiry.days', { n: r.daysLeft })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </div>
        )}
      </div>
    </>
  );
}
