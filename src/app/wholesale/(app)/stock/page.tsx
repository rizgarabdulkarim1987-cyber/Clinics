import type { Metadata } from 'next';
import { ArrowLeftRight, ChevronDown, ClipboardList, Package, PackagePlus, Pencil, Tag } from 'lucide-react';
import { Chip, Fold } from '../../_ui/Ui';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { itemsQuery, stockQuery, warehousesQuery } from '@/server/wholesale/queries/catalog';
import { expiryQuery } from '@/server/wholesale/queries/reports';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, StatusBadge } from '@/studio/ui';
import { ItemForm, PricesForm, type ItemRow } from '../../_ui/ItemForm';
import { PageHeader } from '../../_ui/PageHeader';
import { StockCountForm } from '../../_ui/StockCountForm';
import { TransferForm } from '../../_ui/PeopleForms';

export const metadata: Metadata = { title: 'Items and stock' };

type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;
const number = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

/**
 * Items and their stock on one screen: each item is one line with what is in each warehouse, its prices and (for a partner)
 * the buttons to edit it. New item, sending stock to a rep and the stock count are folded above the list.
 */
export default async function StockPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const locale = actor!.locale;
  const canManage = canWh(actor!.role, 'catalog.manage');
  const canTransfer = canWh(actor!.role, 'stock.transfer');
  const canCount = canWh(actor!.role, 'stock.count');
  const showCost = canWh(actor!.role, 'cost.view');
  const [items, rows, warehouses, expiry] = await Promise.all([queryWh(itemsQuery), queryWh(stockQuery), queryWh(warehousesQuery), queryWh(expiryQuery)]);
  const nextExpiry = new Map<string, (typeof expiry.rows)[number]>();
  for (const r of expiry.rows) if (!nextExpiry.has(r.itemId)) nextExpiry.set(r.itemId, r);
  const all = items as unknown as (ItemRow & { active: boolean })[];
  const byItem = new Map<string, typeof rows>();
  for (const r of rows) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  const countRows = all.filter((i) => i.active).map((i) => ({ itemId: i.id, label: nameOf(i.names, locale), unit: i.baseUnit, book: Object.fromEntries((byItem.get(i.id) ?? []).map((r) => [r.warehouseId, r.qtyBase])) }));
  const unitLabels = Object.fromEntries([...new Set(all.map((i) => i.baseUnit))].map((u) => [u, t(`wh.unit.${u}`)]));
  const where = (r: (typeof rows)[number]) => (r.warehouseKind === 'REP' ? r.warehouseName : t(`wh.stock.kind.${r.warehouseKind}`));
  return (
    <>
      <PageHeader icon={Package} tone="blue" title={t('wh.stock.title')} description={t('wh.stock.description')} />
      <div className="flex flex-col gap-3 px-4 pb-4 md:px-6">
        {canManage && (
          <Fold icon={PackagePlus} tone="green" title={t('wh.catalog.new')}>
            <ItemForm />
          </Fold>
        )}
        {canTransfer && (
          <Fold icon={ArrowLeftRight} tone="violet" title={t('wh.stock.transferTitle')}>
              <p className="mb-3 text-sm text-muted">{t('wh.stock.transferBody')}</p>
              <TransferForm
                items={all.filter((i) => i.active).map((i) => ({ id: i.id, label: `${nameOf(i.names, locale)} · ${i.code}` }))}
                warehouses={warehouses.filter((w) => w.kind === 'REP').map((w) => ({ id: w.id, label: w.name }))}
              />
          </Fold>
        )}
        {canCount && (
          <Fold icon={ClipboardList} tone="teal" title={t('wh.count.title')}>
              <p className="mb-3 text-sm text-muted">{t('wh.count.body')}</p>
              <StockCountForm warehouses={warehouses.filter((w) => w.kind !== 'DAMAGE').map((w) => ({ id: w.id, label: w.kind === 'MAIN' ? t('wh.stock.kind.MAIN') : w.name }))} rows={countRows} unitLabels={unitLabels} />
          </Fold>
        )}
        {all.length === 0 ? (
          <EmptyState title={t('wh.catalog.empty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line bg-raised md:max-h-[calc(100dvh-17.5rem)]">
            {all.map((item) => {
              const stock = byItem.get(item.id) ?? [];
              return (
                <li key={item.id}>
                  <details className="group">
                    <summary className={`flex list-none items-start gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden ${canManage ? 'cursor-pointer hover:bg-hover' : ''}`}>
                      <Chip icon={Package} tone="blue" />
                      <span className="grid min-w-0 flex-1 gap-x-4 gap-y-1.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1.2fr)]">
                        <span className="min-w-0">
                          <span className="block truncate text-base font-semibold" dir="auto">
                            {nameOf(item.names, locale)}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                            <span dir="ltr">{item.code}</span>
                            {nextExpiry.has(item.id) && (
                              <StatusBadge tone={nextExpiry.get(item.id)!.status === 'expired' ? 'danger' : nextExpiry.get(item.id)!.status === 'soon' ? 'ink' : 'neutral'}>
                                {t('wh.expiry.next')} <span dir="ltr">{nextExpiry.get(item.id)!.expiry}</span>
                              </StatusBadge>
                            )}
                            {!item.active && <StatusBadge tone="neutral">{t('wh.common.archived')}</StatusBadge>}
                          </span>
                        </span>
                        <span className="flex flex-wrap content-start gap-1.5" aria-label={t('wh.stock.qty')}>
                          {stock.length === 0 ? (
                            <span className="rounded-md bg-hover px-2 py-1 text-sm text-muted tabular-nums">0</span>
                          ) : (
                            stock.map((r) => (
                              <span key={r.warehouseId} className={`inline-flex items-baseline gap-1.5 rounded-md px-2 py-1 text-sm ${r.warehouseKind === 'MAIN' ? 'bg-wh-blue-wash text-wh-blue' : 'bg-wh-teal-wash text-wh-teal'}`}>
                                <span>{where(r)}</span>
                                <strong className="tabular-nums" dir="ltr">
                                  {number(r.qtyBase)}
                                </strong>
                                <span className="opacity-70">{t(`wh.unit.${item.baseUnit}`)}</span>
                              </span>
                            ))
                          )}
                        </span>
                        <span className="flex flex-wrap content-start gap-x-4 gap-y-0.5 text-sm">
                          {item.units.map((u) => (
                            <span key={u.unit} className="inline-flex items-baseline gap-1.5">
                              <span className="text-muted">{t(`wh.unit.${u.unit}`)}</span>
                              <strong className="tabular-nums" dir="ltr">
                                {item.prices.find((p) => p.unit === u.unit) ? Number(item.prices.find((p) => p.unit === u.unit)!.priceIqd).toLocaleString('en-US') : '—'}
                              </strong>
                            </span>
                          ))}
                        </span>
                      </span>
                      {canManage && <ChevronDown aria-hidden className="mt-2 size-4 shrink-0 text-muted group-open:rotate-180" />}
                    </summary>
                    {canManage && (
                      <div className="grid gap-4 border-t border-line bg-bg p-4 lg:grid-cols-2">
                        {showCost && stock.some((r) => 'avgCostIqd' in r) && (
                          <p className="text-sm text-muted lg:col-span-2">
                            {stock.filter((r) => 'avgCostIqd' in r).map((r) => `${where(r)}: ${number(r.avgCostIqd as string)} IQD`).join(' · ')}
                          </p>
                        )}
                        <div>
                          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
                            <Pencil aria-hidden className="size-4 text-muted" />
                            {t('wh.common.edit')}
                          </h3>
                          <ItemForm item={item} />
                        </div>
                        <div>
                          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
                            <Tag aria-hidden className="size-4 text-muted" />
                            {t('wh.catalog.prices')}
                          </h3>
                          <PricesForm item={item} />
                        </div>
                      </div>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
