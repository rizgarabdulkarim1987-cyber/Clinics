import type { Metadata } from 'next';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { itemsQuery, stockQuery, warehousesQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, PageHeader } from '@/studio/ui';
import { StockCountForm } from '../../_ui/StockCountForm';
import { TransferForm } from '../../_ui/PeopleForms';

export const metadata: Metadata = { title: 'Stock' };

type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;
const number = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

export default async function StockPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const rows = await queryWh(stockQuery);
  const showCost = canWh(actor!.role, 'cost.view');
  const canTransfer = canWh(actor!.role, 'stock.transfer');
  const canCount = canWh(actor!.role, 'stock.count');
  const [items, warehouses] = canTransfer || canCount ? await Promise.all([queryWh(itemsQuery), queryWh(warehousesQuery)]) : [[], []];
  const countRows = items
    .filter((i) => i.active)
    .map((i) => ({ itemId: i.id, label: nameOf(i.names, actor!.locale), unit: i.baseUnit, book: Object.fromEntries(rows.filter((r) => r.itemId === i.id).map((r) => [r.warehouseId, r.qtyBase])) }));
  const unitLabels = Object.fromEntries([...new Set(items.map((i) => i.baseUnit))].map((u) => [u, t(`wh.unit.${u}`)]));
  return (
    <>
      <PageHeader title={t('wh.stock.title')} description={t('wh.stock.description')} />
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        {canTransfer && (
          <section className="rounded-md border border-line bg-raised p-4">
            <h2 className="text-md font-semibold">{t('wh.stock.transferTitle')}</h2>
            <p className="mb-3 text-sm text-muted">{t('wh.stock.transferBody')}</p>
            <TransferForm
              items={items.filter((i) => i.active).map((i) => ({ id: i.id, label: `${nameOf(i.names, actor!.locale)} · ${i.code}` }))}
              warehouses={warehouses.filter((w) => w.kind === 'REP').map((w) => ({ id: w.id, label: w.name }))}
            />
          </section>
        )}
        {canCount && (
          <details className="rounded-md border border-line bg-raised">
            <summary className="flex min-h-12 cursor-pointer items-center px-4 text-md font-semibold">{t('wh.count.title')}</summary>
            <div className="border-t border-line p-4">
              <p className="mb-3 text-sm text-muted">{t('wh.count.body')}</p>
              <StockCountForm warehouses={warehouses.filter((w) => w.kind !== 'DAMAGE').map((w) => ({ id: w.id, label: w.kind === 'MAIN' ? t('wh.stock.kind.MAIN') : w.name }))} rows={countRows} unitLabels={unitLabels} />
            </div>
          </details>
        )}
        {rows.length === 0 ? (
          <EmptyState title={t('wh.stock.empty')} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-raised">
            <table className="w-full text-base">
              <caption className="sr-only">{t('wh.stock.caption')}</caption>
              <thead className="border-b border-line text-start text-sm text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('wh.stock.warehouse')}</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('wh.stock.item')}</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">{t('wh.stock.qty')}</th>
                  {showCost && <th scope="col" className="px-4 py-2 text-end font-medium">{t('wh.stock.avgCost')}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.warehouseId}:${r.itemId}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-2" dir="auto">
                      {r.warehouseKind === 'REP' ? (
                        <>
                          {r.warehouseName} <span className="text-muted">· {t('wh.stock.kind.REP')}</span>
                        </>
                      ) : (
                        t(`wh.stock.kind.${r.warehouseKind}`)
                      )}
                    </td>
                    <td className="px-4 py-2" dir="auto">
                      {nameOf(r.itemNames, actor!.locale)} <span className="text-muted">· {r.itemCode}</span>
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums" dir="ltr">{number(r.qtyBase)}</td>
                    {showCost && <td className="px-4 py-2 text-end tabular-nums" dir="ltr">{'avgCostIqd' in r ? number(r.avgCostIqd as string) : ''}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
