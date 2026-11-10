import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { alertsQuery, dashboardQuery, expiryQuery } from '@/server/wholesale/queries/reports';
import { getStudioTranslator } from '@/studio/messages';
import { Pane } from '../../_ui/Hub';
import CustomersPage from '../customers/page';
import ExpensesPage from '../expenses/page';
import PurchasesPage from '../purchases/page';
import RatesPage from '../rates/page';
import SalesPage from '../sales/page';
import StockPage from '../stock/page';
import SuppliersPage from '../suppliers/page';
import TreasuryPage from '../treasury/page';

export const metadata: Metadata = { title: 'Desk' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;
const tile = 'flex min-w-0 flex-col justify-center rounded-lg border border-line border-s-4 bg-raised px-3 py-1.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]';

/**
 * The whole company on one screen, nothing to switch to: one slim strip of numbers, then selling, customers and stock, then
 * suppliers, purchases, the till, expenses, exchange rates and what needs a look. Each part scrolls inside its own frame.
 */
export default async function DeskPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const locale = actor!.locale;
  const can = (p: Parameters<typeof canWh>[1]) => canWh(actor!.role, p);
  const board = can('report.view') ? await queryWh(dashboardQuery) : null;
  const watch = board ? await queryWh(alertsQuery) : null;
  const expiry = board ? await queryWh(expiryQuery) : null;
  const owed = (m: Record<string, string>) => (Object.keys(m).length === 0 ? '0' : Object.entries(m).map(([c, v]) => `${money(v)} ${c}`).join(' · '));
  const stat = (label: string, value: ReactNode, tone: string, href?: string) => {
    const inner = (
      <>
        <span className="truncate text-xs text-muted">{label}</span>
        <span className="truncate text-base font-semibold tabular-nums" dir="ltr">
          {value}
        </span>
      </>
    );
    return href ? (
      <Link key={label} href={href} className={`${tile} ${tone} hover:bg-hover`}>
        {inner}
      </Link>
    ) : (
      <div key={label} className={`${tile} ${tone}`}>
        {inner}
      </div>
    );
  };
  const watchRows = [
    ...(expiry?.rows ?? [])
      .filter((r) => r.status !== 'ok')
      .map((r) => ({ key: `x-${r.itemId}-${r.expiry}`, text: `${nameOf(r.names as Names, locale)} · ${r.status === 'expired' ? t('wh.expiry.expired') : t('wh.expiry.days', { n: r.daysLeft })}`, high: r.status === 'expired' })),
    ...(watch?.alerts ?? []).map((a) => ({ key: `a-${a.kind}-${a.saleId ?? a.customerId ?? a.customer}`, text: t(`wh.alert.${a.kind}`, { ...a.params, name: a.customer || (a.itemNames ? nameOf(a.itemNames as Names, locale) : '') }), high: a.severity === 'high' })),
    ...(board?.lowStock ?? []).map((x) => ({ key: `l-${x.itemId}`, text: `${nameOf(x.names as Names, locale)} · ${money(x.qtyBase)} / ${money(x.reorderPoint)}`, high: false })),
  ];
  const top: { node: ReactNode; span?: string }[] = [];
  if (can('sale.create')) top.push({ node: <SalesPage searchParams={Promise.resolve({})} />, span: 'xl:col-span-2' });
  if (can('catalog.view')) top.push({ node: <CustomersPage /> });
  if (can('stock.view')) top.push({ node: <StockPage /> });
  const bottom: ReactNode[] = [];
  if (can('catalog.manage')) bottom.push(<SuppliersPage />);
  if (can('purchase.manage')) bottom.push(<PurchasesPage />);
  if (can('custody.submit')) bottom.push(<TreasuryPage />);
  if (can('expense.submit')) bottom.push(<ExpensesPage />);
  if (can('rate.set')) bottom.push(<RatesPage />);
  if (board) {
    bottom.push(
      <div className="p-4">
        <h2 className="mb-2 text-lg font-semibold">{t('wh.alert.title')}</h2>
        {watchRows.length === 0 ? (
          <p className="text-sm text-muted">{t('wh.home.allClear')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {watchRows.map((r) => (
              <li key={r.key} className={`truncate rounded-md px-2 py-1 text-sm ${r.high ? 'bg-danger-wash text-danger' : 'bg-hover'}`} dir="auto" title={r.text}>
                {r.text}
              </li>
            ))}
          </ul>
        )}
      </div>,
    );
  }
  return (
    <div className="flex flex-col gap-2 px-4 py-2 md:min-h-0 md:flex-1 md:px-6">
      {board && (
        <section className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          {stat(t('wh.home.cash'), `${money(board.cash.IQD ?? '0')} IQD${Number(board.cash.USD ?? 0) ? ` · ${money(board.cash.USD ?? '0')} USD` : ''}`, 'border-s-wh-green')}
          {stat(t('wh.home.todaySales'), money(board.todaySales.iqd), 'border-s-wh-blue', '/wholesale/reports?tab=profit')}
          {stat(t('wh.home.monthProfit'), money(board.monthProfit.netIqd), 'border-s-wh-violet', '/wholesale/reports?tab=profit')}
          {stat(t('wh.home.receivable'), owed(board.receivable), 'border-s-wh-amber', '/wholesale/reports?tab=debts')}
          {stat(t('wh.home.payable'), owed(board.payable), 'border-s-wh-rose', '/wholesale/reports?tab=debts')}
          {stat(t('wh.home.stockValue'), `${money(board.stockValueIqd)} IQD`, 'border-s-wh-teal', '/wholesale/reports?tab=stock')}
          {stat(t('wh.nav.reports'), '→', 'border-s-wh-violet', '/wholesale/reports')}
        </section>
      )}
      <div className="grid gap-2 md:min-h-0 md:flex-[3] md:grid-cols-2 xl:grid-cols-4">
        {top.map((p, i) => (
          <Pane key={i} className={p.span ?? ''}>
            {p.node}
          </Pane>
        ))}
      </div>
      <div className="grid gap-2 md:min-h-0 md:flex-[2] md:grid-cols-3 xl:grid-cols-6">
        {bottom.map((p, i) => (
          <Pane key={i}>{p}</Pane>
        ))}
      </div>
    </div>
  );
}
