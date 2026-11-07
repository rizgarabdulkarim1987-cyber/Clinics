import type { Metadata } from 'next';
import { getWhAccess } from '@/server/wholesale/access';
import { queryWh } from '@/server/wholesale/access';
import { itemsQuery } from '@/server/wholesale/queries/catalog';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, PageHeader, StatusBadge } from '@/studio/ui';
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
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        {canManage && (
          <details className="rounded-md border border-line bg-raised">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.catalog.new')}</summary>
            <div className="border-t border-line p-4">
              <ItemForm />
            </div>
          </details>
        )}
        {items.length === 0 ? (
          <EmptyState title={t('wh.catalog.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {(items as unknown as (ItemRow & { active: boolean })[]).map((item) => (
              <li key={item.id} className="rounded-md border border-line bg-raised p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 text-base font-semibold" dir="auto">
                    {nameOf(item.names, actor!.locale)} <span className="text-muted">· {item.code}</span>
                  </p>
                  <StatusBadge tone={item.active ? 'success' : 'neutral'}>{item.active ? t('wh.common.active') : t('wh.common.archived')}</StatusBadge>
                </div>
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
                  {item.units.map((u) => (
                    <div key={u.unit} className="flex gap-1">
                      <dt>{t(`wh.unit.${u.unit}`)}</dt>
                      <dd className="tabular-nums" dir="ltr">
                        {u.factorToBase}
                        {item.prices.find((p) => p.unit === u.unit) ? ` · ${Number(item.prices.find((p) => p.unit === u.unit)!.priceIqd).toLocaleString('en-US')} IQD` : ''}
                      </dd>
                    </div>
                  ))}
                </dl>
                {canManage && (
                  <div className="mt-3 flex flex-col gap-2">
                    <details className="rounded-md border border-line">
                      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-base">{t('wh.common.edit')}</summary>
                      <div className="border-t border-line p-3">
                        <ItemForm item={item} />
                      </div>
                    </details>
                    <details className="rounded-md border border-line">
                      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-base">{t('wh.catalog.prices')}</summary>
                      <div className="border-t border-line p-3">
                        <PricesForm item={item} />
                      </div>
                    </details>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
