import type { Metadata } from 'next';
import { Coins, Handshake, Printer } from 'lucide-react';
import Link from 'next/link';
import { canWh } from '@/server/domain/wholesale/permissions';
import { addDays } from '@/server/domain/wholesale/forecast';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { customersQuery, itemsQuery, stockQuery } from '@/server/wholesale/queries/catalog';
import { expiryQuery, repAccountsQuery, sellInfoQuery } from '@/server/wholesale/queries/reports';
import { repTargetsQuery } from '@/server/wholesale/queries/targets';
import { customerStatementQuery, dayRatesQuery, debtsListQuery, pendingSalesQuery, saleQuery, saleWarehousesQuery, salesQuery } from '@/server/wholesale/queries/sale';
import { getStudioTranslator } from '@/studio/messages';
import { cx } from '@/studio/ui';
import { ApproveButtons, CancelSaleForm, CollectForm, ReturnSaleForm } from '../../_ui/SaleForms';
import { PoweredBy } from '@/studio/shell/PoweredBy';
import { SalesWorkspace } from '../../_ui/SalesWorkspace';
import { RepAccounts } from '../../_ui/RepAccounts';
import { TargetBars } from '../../_ui/TargetBars';

export const metadata: Metadata = { title: 'Sales' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

type Search = Promise<{ c?: string; s?: string; p?: string; from?: string; to?: string; by?: string }>;
const isoDay = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Sales: the one screen the day runs on. The invoice is built on the start side; the chosen customer's account, collecting, recent
 * sales, returns and cancelling open in the side panel (`?c=` the customer, `?s=` the sale shown), never on another page.
 */
export default async function SalesPage({ searchParams }: { searchParams: Search }) {
  const { c, s, p, from: fromParam, to: toParam, by } = await searchParams;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const locale = actor!.locale;
  const isRep = actor!.role === 'REP';
  const [sales, customers, warehouses, items, pending, info, debtList] = await Promise.all([
    queryWh(salesQuery),
    queryWh(customersQuery),
    queryWh(saleWarehousesQuery),
    queryWh(itemsQuery),
    canWh(actor!.role, 'sale.override') ? queryWh(pendingSalesQuery) : Promise.resolve([]),
    queryWh(sellInfoQuery).catch((error) => {
      console.error('wholesale sell info failed', error);
      return null;
    }),
    queryWh(debtsListQuery).catch((error) => {
      console.error('wholesale debts failed', error);
      return null;
    }),
  ]);
  const goal = isRep ? await queryWh(repTargetsQuery).catch(() => null) : null;
  const mine = goal?.reps[0] ?? null;
  const myAccount = isRep ? ((await queryWh(repAccountsQuery).catch(() => []))[0] ?? null) : null;
  const stock = await queryWh(stockQuery).catch(() => null);
  const expiryRows = await queryWh(expiryQuery).catch(() => null);
  const nextExpiry = new Map<string, { date: string; status: string }>();
  for (const r of expiryRows?.rows ?? []) if (!nextExpiry.has(r.itemId)) nextExpiry.set(r.itemId, { date: r.expiry, status: r.status });
  const stockOf: Record<string, Record<string, string>> = {};
  for (const r of stock ?? []) (stockOf[r.itemId] ??= {})[r.warehouseId] = r.qtyBase;
  const stockRows = new Map<string, { name: string; unit: string; mine: number }>();
  for (const r of stock ?? []) {
    const row = stockRows.get(r.itemId) ?? { name: nameOf(r.itemNames as Names, locale), unit: r.baseUnit, mine: 0 };
    row.mine += Number(r.qtyBase);
    stockRows.set(r.itemId, row);
  }
  const activeCustomers = customers.filter((x) => x.active);
  const customerId = c && activeCustomers.some((x) => x.id === c) ? c : null;
  const [statement, sale] = await Promise.all([
    customerId ? queryWh(customerStatementQuery, { id: customerId }).catch(() => null) : Promise.resolve(null),
    s ? queryWh(saleQuery, { id: s }).catch(() => null) : Promise.resolve(null),
  ]);
  const today = baghdadDate();
  const period = p === 'week' || p === 'month' || p === 'year' || p === 'custom' ? p : 'today';
  const range =
    period === 'week'
      ? { from: addDays(today, -6), to: today }
      : period === 'month'
        ? { from: `${today.slice(0, 7)}-01`, to: today }
        : period === 'year'
          ? { from: `${today.slice(0, 4)}-01-01`, to: today }
          : period === 'custom'
            ? { from: isoDay(fromParam) ?? today, to: isoDay(toParam) ?? today }
            : { from: today, to: today };
  const sellerPick = by && by.length <= 64 ? by : undefined;
  const rangeSales = period === 'today' && !sellerPick ? sales.filter((x) => x.date === today) : await queryWh(salesQuery, { ...range, ...(sellerPick ? { sellerId: sellerPick } : {}) });
  const sellerOptions = [...new Map(sales.flatMap((x) => (x.seller ? [[x.userId, `${x.seller.name} (${t(`wh.role.${x.seller.role}`)})`] as const] : []))).entries()].map(([id, label]) => ({ id, label }));
  const rangeTotals: Record<string, number> = {};
  for (const x of rangeSales) if (x.status === 'POSTED') rangeTotals[x.currency] = (rangeTotals[x.currency] ?? 0) + Number(x.totalFinal);
  const owed = statement ? Object.entries(statement.balances).filter(([, v]) => Number(v) !== 0) : [];
  const shownSales = (customerId ? sales.filter((x) => x.customer.id === customerId) : sales).slice(0, 12);
  const sellerOf = (x: { seller: { name: string; role: string } | null }) => (x.seller ? `${x.seller.name} (${t(`wh.role.${x.seller.role}`)})` : '');
  const canOverride = canWh(actor!.role, 'sale.override');
  const usable = items.filter((i) => i.active);
  const todayPosted = canOverride ? rangeSales.filter((x) => x.date === today && x.status === 'POSTED') : [];
  const detailRows = await Promise.all(todayPosted.map((x) => queryWh(saleQuery, { id: x.id }).catch(() => null)));
  const editable = new Map(detailRows.flatMap((d) => (d && d.payments.length === 0 ? [[d.id, d] as const] : [])));
  const soldToday = sales.filter((x) => x.status === 'POSTED' && x.date === today);
  const todayTotals: Record<string, number> = {};
  for (const x of soldToday) todayTotals[x.currency] = (todayTotals[x.currency] ?? 0) + Number(x.totalFinal);
  const itemOptions = usable.map((i) => ({ id: i.id, label: `${nameOf(i.names, locale)}`, units: [...new Set([i.baseUnit, ...i.units.map((u) => u.unit)])] }));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-1 pt-2">
        {!isRep && (
          <>
          <Link href="/wholesale/agency" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-sm font-semibold hover:bg-wh-violet-wash">
            <Handshake aria-hidden className="size-4 text-wh-violet" />
            {t('wh.agency.title')}
          </Link>
          {canWh(actor!.role, 'rate.set') && (
            <Link href="/wholesale/rates" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-sm font-semibold hover:bg-wh-amber-wash">
              <Coins aria-hidden className="size-4 text-wh-amber" />
              {t('wh.nav.rates')}
            </Link>
          )}
          </>
        )}
        <PoweredBy className="mr-auto px-0 py-0" />
      </div>
    <SalesWorkspace
      today={today}
      isRep={isRep}
      customerId={customerId}
      debt={owed.map(([cur, v]) => `${money(v!)} ${cur}`).join(' · ')}
      attention={pending.length}
      debts={debtList?.rows ?? []}
      period={period}
      rates={await queryWh(dayRatesQuery)}
      range={range}
      by={sellerPick ?? ''}
      sellerOptions={sellerOptions}
      rangeTotals={Object.entries(rangeTotals).map(([currency, amount]) => ({ currency, amount }))}
      todaySales={rangeSales.map((x) => ({ id: x.id, number: x.number === null ? null : Number(x.number), customer: x.customer.name, total: x.totalFinal, currency: x.currency, mode: x.paymentMode, status: x.status, seller: sellerOf(x), edit: editable.has(x.id) ? { customerId: x.customer.id, currency: x.currency, payment: x.paymentMode, warehouseId: editable.get(x.id)!.warehouse.id, lines: editable.get(x.id)!.lines.map((l) => ({ itemId: l.itemId, unit: l.unit, qty: String(l.qty), mode: l.priceMode, value: l.priceMode === 'PERCENT' ? String(l.percent ?? '') : l.priceMode === 'MANUAL' ? String(l.manualPrice ?? '') : '' })) } : null }))}
      info={{
        todayCount: soldToday.length,
        todayTotals: Object.entries(todayTotals).map(([currency, amount]) => ({ currency, amount })),
        cash: info?.cash ?? null,
        expired: info?.expired ?? 0,
        soon: info?.soon ?? 0,
        next: info?.next ? { name: nameOf(info.next.names, locale), days: info.next.days } : null,
      }}
      customers={activeCustomers.map((x) => ({ id: x.id, name: x.name, phone: x.phone, type: x.type }))}
      warehouses={warehouses.map((w) => ({ id: w.id, label: w.kind === 'MAIN' ? t('wh.stock.kind.MAIN') : w.name }))}
      items={usable.map((i) => ({
        id: i.id,
        label: nameOf(i.names, locale),
        code: i.code,
        baseUnit: i.baseUnit,
        units: i.units.map((u) => ({ unit: u.unit, barcode: u.barcode })),
        prices: Object.fromEntries(i.prices.map((p) => [p.unit, p.priceIqd])),
        marketPrices: Object.fromEntries(i.prices.flatMap((p) => (p.marketPriceIqd ? [[p.unit, p.marketPriceIqd]] : []))),
        stock: stockOf[i.id] ?? {},
        expiry: nextExpiry.get(i.id) ?? null,
      }))}
    >
      {isRep && myAccount && <RepAccounts reps={[myAccount]} t={t} />}
      {isRep && goal && (
        <details className="rounded-md border border-line bg-raised" open={Boolean(mine?.target)}>
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-base font-semibold">{t('wh.target.mine')}</summary>
          <div className="border-t border-line p-3">
            {mine?.target ? <TargetBars row={mine} pace={goal.progress} t={t} locale={locale} /> : <p className="text-sm text-muted">{t('wh.target.none')}</p>}
          </div>
        </details>
      )}
      {isRep && stockRows.size > 0 && (
        <details className="rounded-md border border-line bg-raised">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-base font-semibold">{t('wh.sw.stock')}</summary>
          <table className="w-full border-t border-line text-sm">
            <thead>
              <tr className="text-muted">
                <th className="px-3 py-1.5 text-start font-medium">{t('wh.target.item')}</th>
                <th className="px-3 py-1.5 text-end font-medium">{t('wh.sw.stockMine')}</th>
              </tr>
            </thead>
            <tbody>
              {[...stockRows.values()].map((r) => (
                <tr key={r.name} className="border-t border-line">
                  <td className="px-3 py-1.5" dir="auto">
                    {r.name}
                  </td>
                  <td className="px-3 py-1.5 text-end font-semibold tabular-nums" dir="ltr">
                    {money(String(r.mine))} <span className="font-normal text-muted">{t(`wh.unit.${r.unit}`)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {pending.length > 0 && (
        <section className="flex flex-col gap-3 rounded-md border border-line bg-raised p-3">
          <h2 className="text-md font-semibold">{t('wh.sales.pending')}</h2>
          {pending.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
              <p className="text-base" dir="auto">
                <Link href={`?s=${p.id}`} scroll={false} className="font-semibold underline">
                  #{p.number} · {p.customer.name}
                </Link>{' '}
                <span dir="ltr">
                  {money(p.totalFinal)} {p.currency}
                </span>
              </p>
              <ApproveButtons saleId={p.id} />
            </div>
          ))}
        </section>
      )}

      <section className="rounded-md border border-line bg-raised p-3">
        <h2 className="text-md font-semibold">{t('wh.sw.account')}</h2>
        {!customerId ? (
          <p className="pt-2 text-base text-muted">{t('wh.sw.pickToSee')}</p>
        ) : (
          <div className="flex flex-col gap-3 pt-2">
            {owed.length === 0 ? (
              <p className="text-base text-muted">{t('wh.cstatement.settled')}</p>
            ) : (
              <p className="flex flex-col">
                <span className="text-sm text-muted">{t('wh.sw.debt')}</span>
                {owed.map(([cur, v]) => (
                  <span key={cur} className="text-xl font-semibold tabular-nums" dir="ltr">
                    {money(v!)} {cur}
                  </span>
                ))}
              </p>
            )}
            <details className="rounded-md border border-line" open={owed.length > 0}>
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-base font-semibold">{t('wh.collect.title')}</summary>
              <div className="border-t border-line p-3">
                <CollectForm customerId={customerId} currency={owed[0]?.[0] ?? 'IQD'} today={today} isRep={isRep} />
              </div>
            </details>
            <Link href={`/wholesale/customers/${customerId}`} className="text-sm text-muted underline">
              {t('wh.sales.statement')}
            </Link>
          </div>
        )}
      </section>

      <section className="rounded-md border border-line bg-raised">
        <h2 className="border-b border-line px-3 py-2 text-md font-semibold">{t('wh.sw.recent')}</h2>
        {shownSales.length === 0 ? (
          <p className="px-3 py-6 text-center text-base text-muted">{t('wh.sw.noRecent')}</p>
        ) : (
          <ul>
            {shownSales.map((x) => {
              const open = sale?.id === x.id;
              return (
                <li key={x.id} className="border-b border-line last:border-0">
                  <Link
                    href={open ? (customerId ? `?c=${customerId}` : '?') : customerId ? `?c=${customerId}&s=${x.id}` : `?s=${x.id}`}
                    scroll={false}
                    aria-expanded={open}
                    className={cx('flex min-h-14 items-center justify-between gap-2 px-3 py-2 hover:bg-hover', open && 'bg-hover')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-base font-medium" dir="auto">
                        #{x.number} · {x.customer.name}
                      </span>
                      <span className="block text-sm text-muted" dir="ltr">
                        {x.date} · {x.paymentMode === 'CREDIT' ? t('wh.purchases.credit') : t('wh.purchases.cash')}
                        {x.status !== 'POSTED' ? ` · ${t(`wh.sales.status.${x.status}`)}` : ''}
                      </span>
                      {x.seller && (
                        <span className="block truncate text-sm text-wh-blue" dir="auto">
                          {t('wh.sales.seller')}: {sellerOf(x)}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-base font-semibold tabular-nums" dir="ltr">
                      {money(x.totalFinal)} {x.currency}
                    </span>
                  </Link>
                  {open && sale && (
                    <div className="flex flex-col gap-3 border-t border-line bg-bg px-3 py-3">
                      <ul className="flex flex-col gap-1 text-base">
                        {sale.lines.map((l) => (
                          <li key={l.id} className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate" dir="auto">
                              {nameOf(l.itemNames as Names, locale)}
                            </span>
                            <span className="shrink-0 tabular-nums" dir="ltr">
                              {money(l.qty)} {t(`wh.unit.${l.unit}`)} × {money(l.finalPrice)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {sale.status === 'POSTED' && (
                        <Link href={`/wholesale/sales/${sale.id}/print`} target="_blank" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-wh-blue px-3 text-base font-semibold text-white">
                          <Printer aria-hidden className="size-4" />
                          {t('wh.print.open')}
                        </Link>
                      )}
                      {sale.status === 'POSTED' && canWh(actor!.role, 'sale.return') && (
                        <details className="rounded-md border border-line bg-raised">
                          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-base font-semibold">{t('wh.sales.returnButton')}</summary>
                          <div className="border-t border-line p-3">
                            <ReturnSaleForm
                              saleId={sale.id}
                              paymentMode={sale.paymentMode}
                              lines={sale.lines.map((l) => ({ id: l.id, label: nameOf(l.itemNames as Names, locale), unit: l.unit, qty: money(l.qty) }))}
                              items={itemOptions.map((i) => ({ id: i.id, label: i.label, units: i.units }))}
                            />
                          </div>
                        </details>
                      )}
                      {sale.status === 'POSTED' && canWh(actor!.role, 'sale.override') && (
                        <details className="rounded-md border border-line bg-raised">
                          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-base font-semibold">{t('wh.sales.cancel')}</summary>
                          <div className="border-t border-line p-3">
                            <CancelSaleForm saleId={sale.id} />
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </SalesWorkspace>
    </>
  );
}
