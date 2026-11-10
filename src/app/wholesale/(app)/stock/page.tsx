import type { Metadata } from 'next';
import { ArrowLeftRight, ClipboardList, Package, PackagePlus } from 'lucide-react';
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
                <li key={item.id} className="flex items-start gap-3 px-3 py-2.5">
                  <Chip icon={Package} tone="blue" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <p className="min-w-0 text-base font-semibold" dir="auto">
                      {nameOf(item.names, locale)} <span className="font-normal text-muted">· {item.code}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <p className="flex flex-wrap gap-x-3 text-sm" aria-label={t('wh.stock.qty')}>
                        {stock.length === 0 ? (
                          <span className="text-muted">0</span>
                        ) : (
                          stock.map((r) => (
                            <span key={r.warehouseId} className="tabular-nums" dir="ltr">
                              <span className="text-muted">{where(r)} </span>
                              <strong>{number(r.qtyBase)}</strong> <span className="text-muted">{t(`wh.unit.${item.baseUnit}`)}</span>
                              {showCost && 'avgCostIqd' in r ? <span className="text-muted"> @ {number(r.avgCostIqd as string)}</span> : null}
                            </span>
                          ))
                        )}
                      </p>
                      <dl className="flex flex-wrap gap-x-3 text-sm text-muted">
                        {item.units.map((u) => (
                          <div key={u.unit} className="flex gap-1">
                            <dt>{t(`wh.unit.${u.unit}`)}</dt>
                            <dd className="tabular-nums" dir="ltr">
                              {item.prices.find((p) => p.unit === u.unit) ? Number(item.prices.find((p) => p.unit === u.unit)!.priceIqd).toLocaleString('en-US') : u.factorToBase}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {nextExpiry.has(item.id) && (
                        <StatusBadge tone={nextExpiry.get(item.id)!.status === 'expired' ? 'danger' : nextExpiry.get(item.id)!.status === 'soon' ? 'ink' : 'neutral'}>
                          {t('wh.expiry.next')} <span dir="ltr">{nextExpiry.get(item.id)!.expiry}</span>
                        </StatusBadge>
                      )}
                      {!item.active && <StatusBadge tone="neutral">{t('wh.common.archived')}</StatusBadge>}
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
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
