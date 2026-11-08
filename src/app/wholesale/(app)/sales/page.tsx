import type { Metadata } from 'next';
import Link from 'next/link';
import { canWh } from '@/server/domain/wholesale/permissions';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { customersQuery, itemsQuery } from '@/server/wholesale/queries/catalog';
import { pendingSalesQuery, saleWarehousesQuery, salesQuery } from '@/server/wholesale/queries/sale';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, PageHeader, StatusBadge } from '@/studio/ui';
import { ApproveButtons, SaleForm } from '../../_ui/SaleForms';

export const metadata: Metadata = { title: 'Sales' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

export default async function SalesPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const isRep = actor!.role === 'REP';
  const [sales, customers, warehouses, items, pending] = await Promise.all([
    queryWh(salesQuery),
    queryWh(customersQuery),
    queryWh(saleWarehousesQuery),
    queryWh(itemsQuery),
    canWh(actor!.role, 'sale.override') ? queryWh(pendingSalesQuery) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={t('wh.sales.title')} description={isRep ? t('wh.sales.descriptionRep') : t('wh.sales.description')} />
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        {pending.length > 0 && (
          <section className="flex flex-col gap-3 rounded-md border border-line bg-raised p-4">
            <h2 className="text-md font-semibold">{t('wh.sales.pending')}</h2>
            {pending.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
                <p className="text-base" dir="auto">
                  <Link href={`/wholesale/sales/${p.id}`} className="font-semibold underline">
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
        <details className="rounded-md border border-line bg-raised">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.sales.new')}</summary>
          <div className="border-t border-line p-4">
            <SaleForm
              today={baghdadDate()}
              isRep={isRep}
              customers={customers.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
              warehouses={warehouses.map((w) => ({ id: w.id, label: w.kind === 'MAIN' ? t('wh.stock.kind.MAIN') : w.name }))}
              items={items
                .filter((i) => i.active)
                .map((i) => ({ id: i.id, label: `${nameOf(i.names, actor!.locale)} · ${i.code}`, units: [...new Set([i.baseUnit, ...i.units.map((u) => u.unit)])] }))}
            />
          </div>
        </details>
        {sales.length === 0 ? (
          <EmptyState title={t('wh.sales.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {sales.map((s) => (
              <li key={s.id}>
                <Link href={`/wholesale/sales/${s.id}`} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-line bg-raised p-4 hover:border-ink">
                  <span>
                    <span className="text-base font-semibold" dir="auto">
                      #{s.number} · {s.customer.name}
                    </span>
                    <span className="block text-sm text-muted" dir="ltr">
                      {s.date} · {s.paymentMode === 'CREDIT' ? t('wh.purchases.credit') : t('wh.purchases.cash')}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {s.status !== 'POSTED' && <StatusBadge tone="neutral">{t(`wh.sales.status.${s.status}`)}</StatusBadge>}
                    <span className="text-base font-semibold tabular-nums" dir="ltr">
                      {money(s.totalFinal)} {s.currency}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
