import type { Metadata } from 'next';
import { getWhAccess } from '@/server/wholesale/access';
import { queryWh } from '@/server/wholesale/access';
import { itemsQuery } from '@/server/wholesale/queries/catalog';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, StatusBadge } from '@/studio/ui';
import { PageHeader } from '../../_ui/PageHeader';
import { ItemForm, PricesForm, type ItemRow } from '../../_ui/ItemForm';

export const metadata: Metadata = { title: 'Items' };

const nameOf = (names: { ckb: string; ar: string; en: string }, locale: string) =>
  (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

export default async function CatalogPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const items = (await queryWh(itemsQuery)) as ItemRow[] & { active: boolean }[];
  const canManage = canWh(actor!.role, 'catalog.manage');
  return (
    <>
      <PageHeader title={t('wh.catalog.title')} description={t('wh.catalog.description')} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        {canManage && (
          <details className="rounded-md border border-line bg-raised">
            <summary className="flex min-h-10 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.catalog.new')}</summary>
            <div className="border-t border-line p-4">
              <ItemForm />
            </div>
          </details>
        )}
        {items.length === 0 ? (
          <EmptyState title={t('wh.catalog.empty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-y-auto rounded-md border border-line bg-raised md:max-h-[calc(100dvh-12.5rem)]">
            {(items as unknown as (ItemRow & { active: boolean })[]).map((item) => (
              <li key={item.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <p className="min-w-0 text-base font-semibold" dir="auto">
                    {nameOf(item.names, actor!.locale)} <span className="font-normal text-muted">· {item.code}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <dl className="flex flex-wrap gap-x-4 text-sm text-muted">
                      {item.units.map((u) => (
                        <div key={u.unit} className="flex gap-1">
                          <dt>{t(`wh.unit.${u.unit}`)}</dt>
                          <dd className="tabular-nums" dir="ltr">
                            {item.prices.find((p) => p.unit === u.unit) ? Number(item.prices.find((p) => p.unit === u.unit)!.priceIqd).toLocaleString('en-US') : u.factorToBase}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <StatusBadge tone={item.active ? 'success' : 'neutral'}>{item.active ? t('wh.common.active') : t('wh.common.archived')}</StatusBadge>
                    {canManage && (
                      <>
                        <details className="rounded-md border border-line open:basis-full">
                          <summary className="flex min-h-9 cursor-pointer items-center px-3 text-sm font-medium">{t('wh.common.edit')}</summary>
                          <div className="border-t border-line p-3">
                            <ItemForm item={item} />
                          </div>
                        </details>
                        <details className="rounded-md border border-line open:basis-full">
                          <summary className="flex min-h-9 cursor-pointer items-center px-3 text-sm font-medium">{t('wh.catalog.prices')}</summary>
                          <div className="border-t border-line p-3">
                            <PricesForm item={item} />
                          </div>
                        </details>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
