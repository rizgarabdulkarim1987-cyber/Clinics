import type { Metadata } from 'next';
import Link from 'next/link';
import { canWh } from '@/server/domain/wholesale/permissions';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { customersQuery, itemsQuery } from '@/server/wholesale/queries/catalog';
import { customerStatementQuery, pendingSalesQuery, saleQuery, saleWarehousesQuery, salesQuery } from '@/server/wholesale/queries/sale';
import { getStudioTranslator } from '@/studio/messages';
import { cx } from '@/studio/ui';
import { ApproveButtons, CancelSaleForm, CollectForm, ReturnSaleForm } from '../../_ui/SaleForms';
import { SalesWorkspace } from '../../_ui/SalesWorkspace';

export const metadata: Metadata = { title: 'Sales' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

type Search = Promise<{ c?: string; s?: string }>;

/**
 * Sales: the one screen the day runs on. The invoice is built on the start side; the chosen customer's account, collecting, recent
 * sales, returns and cancelling open in the side panel (`?c=` the customer, `?s=` the sale shown), never on another page.
 */
export default async function SalesPage({ searchParams }: { searchParams: Search }) {
  const { c, s } = await searchParams;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const locale = actor!.locale;
  const isRep = actor!.role === 'REP';
  const [sales, customers, warehouses, items, pending] = await Promise.all([
    queryWh(salesQuery),
    queryWh(customersQuery),
    queryWh(saleWarehousesQuery),
    queryWh(itemsQuery),
    canWh(actor!.role, 'sale.override') ? queryWh(pendingSalesQuery) : Promise.resolve([]),
  ]);
  const activeCustomers = customers.filter((x) => x.active);
  const customerId = c && activeCustomers.some((x) => x.id === c) ? c : null;
  const [statement, sale] = await Promise.all([
    customerId ? queryWh(customerStatementQuery, { id: customerId }).catch(() => null) : Promise.resolve(null),
    s ? queryWh(saleQuery, { id: s }).catch(() => null) : Promise.resolve(null),
  ]);
  const today = baghdadDate();
  const owed = statement ? Object.entries(statement.balances).filter(([, v]) => Number(v) !== 0) : [];
  const shownSales = (customerId ? sales.filter((x) => x.customer.id === customerId) : sales).slice(0, 12);
  const usable = items.filter((i) => i.active);
  const itemOptions = usable.map((i) => ({ id: i.id, label: `${nameOf(i.names, locale)}`, units: [...new Set([i.baseUnit, ...i.units.map((u) => u.unit)])] }));

  return (
    <SalesWorkspace
      today={today}
      isRep={isRep}
      customerId={customerId}
      customers={activeCustomers.map((x) => ({ id: x.id, name: x.name, phone: x.phone }))}
      warehouses={warehouses.map((w) => ({ id: w.id, label: w.kind === 'MAIN' ? t('wh.stock.kind.MAIN') : w.name }))}
      items={usable.map((i) => ({
        id: i.id,
        label: nameOf(i.names, locale),
        code: i.code,
        baseUnit: i.baseUnit,
        units: i.units.map((u) => ({ unit: u.unit, barcode: u.barcode })),
        prices: Object.fromEntries(i.prices.map((p) => [p.unit, p.priceIqd])),
      }))}
    >
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
  );
}
