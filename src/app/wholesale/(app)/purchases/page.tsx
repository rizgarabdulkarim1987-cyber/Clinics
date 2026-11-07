import type { Metadata } from 'next';
import Link from 'next/link';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { itemsQuery, suppliersQuery, warehousesQuery } from '@/server/wholesale/queries/catalog';
import { purchasesQuery } from '@/server/wholesale/queries/purchase';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, PageHeader, StatusBadge } from '@/studio/ui';
import { PurchaseForm } from '../../_ui/PurchaseForms';

export const metadata: Metadata = { title: 'Purchases' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

export default async function PurchasesPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const [purchases, suppliers, items, warehouses] = await Promise.all([queryWh(purchasesQuery), queryWh(suppliersQuery), queryWh(itemsQuery), queryWh(warehousesQuery)]);
  return (
    <>
      <PageHeader title={t('wh.purchases.title')} description={t('wh.purchases.description')} />
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        <details className="rounded-md border border-line bg-raised">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.purchases.new')}</summary>
          <div className="border-t border-line p-4">
            <PurchaseForm
              today={baghdadDate()}
              suppliers={suppliers.filter((s) => s.active)}
              items={items
                .filter((i) => i.active)
                .map((i) => ({ id: i.id, label: `${nameOf(i.names, actor!.locale)} · ${i.code}`, units: [...new Set([i.baseUnit, ...i.units.map((u) => u.unit)])] }))}
              warehouses={warehouses.filter((w) => w.kind !== 'DAMAGE').map((w) => ({ id: w.id, label: w.name }))}
            />
          </div>
        </details>
        {purchases.length === 0 ? (
          <EmptyState title={t('wh.purchases.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {purchases.map((p) => (
              <li key={p.id}>
                <Link href={`/wholesale/purchases/${p.id}`} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-line bg-raised p-4 hover:border-ink">
                  <span>
                    <span className="text-base font-semibold" dir="auto">
                      #{p.number} · {p.supplierName}
                    </span>
                    <span className="block text-sm text-muted" dir="ltr">
                      {p.date} · {p.paymentMode === 'CREDIT' ? t('wh.purchases.credit') : t('wh.purchases.cash')}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {p.status === 'CANCELLED' && <StatusBadge tone="neutral">{t('wh.purchases.statusCancelled')}</StatusBadge>}
                    <span className="text-base font-semibold tabular-nums" dir="ltr">
                      {money(p.totalOriginal)} {p.currency}
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
