import type { Metadata } from 'next';
import { Plus, ShoppingCart, Truck } from 'lucide-react';
import { Chip, Fold } from '../../_ui/Ui';
import Link from 'next/link';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { itemsQuery, suppliersQuery, warehousesQuery } from '@/server/wholesale/queries/catalog';
import { purchasesQuery } from '@/server/wholesale/queries/purchase';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, StatusBadge } from '@/studio/ui';
import { HeaderLink, PageHeader } from '../../_ui/PageHeader';
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
      <PageHeader icon={ShoppingCart} tone="amber" title={t('wh.purchases.title')} description={t('wh.purchases.description')} actions={canWh(actor!.role, 'catalog.manage') ? <HeaderLink href="/wholesale/suppliers">{t('wh.nav.suppliers')}</HeaderLink> : undefined} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        <Fold icon={Plus} tone="green" title={t('wh.purchases.new')}>
            <PurchaseForm
              today={baghdadDate()}
              suppliers={suppliers.filter((s) => s.active)}
              items={items
                .filter((i) => i.active)
                .map((i) => ({ id: i.id, label: `${nameOf(i.names, actor!.locale)} · ${i.code}`, units: [...new Set([i.baseUnit, ...i.units.map((u) => u.unit)])] }))}
              warehouses={warehouses.filter((w) => w.kind !== 'DAMAGE').map((w) => ({ id: w.id, label: w.name }))}
            />
        </Fold>
        {purchases.length === 0 ? (
          <EmptyState title={t('wh.purchases.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {purchases.map((p) => (
              <li key={p.id}>
                <Link href={`/wholesale/purchases/${p.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-raised p-3 hover:border-wh-blue">
                  <Chip icon={Truck} tone="amber" />
                  <span className="min-w-0 flex-1">
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
