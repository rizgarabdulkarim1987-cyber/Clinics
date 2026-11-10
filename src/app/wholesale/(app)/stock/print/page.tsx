import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canWh } from '@/server/domain/wholesale/permissions';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { stockQuery, warehousesQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { PrintButton } from '../../../_ui/PrintButton';

export const metadata: Metadata = { title: 'Stock sheet' };

const num = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

/** One warehouse's stock sheet to print or save as PDF: the main warehouse or one rep's, never mixed. */
export default async function StockSheetPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const locale = actor!.locale;
  const [warehouses, rows] = await Promise.all([queryWh(warehousesQuery), queryWh(stockQuery)]);
  const wh = warehouses.find((x) => x.id === w);
  if (!wh) notFound();
  const mine = rows.filter((r) => r.warehouseId === wh.id && Number(r.qtyBase) !== 0).sort((a, b) => nameOf(a.itemNames as Names, locale).localeCompare(nameOf(b.itemNames as Names, locale), locale));
  const showCost = canWh(actor!.role, 'cost.view') && mine.some((r) => 'avgCostIqd' in r);
  const value = (r: (typeof mine)[number]) => ('avgCostIqd' in r ? Number(r.qtyBase) * Number(r.avgCostIqd) : 0);
  const total = mine.reduce((s, r) => s + value(r), 0);
  const title = wh.kind === 'MAIN' ? t('wh.stock.kind.MAIN') : wh.name;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 bg-white p-4 text-black md:p-8 print:max-w-none print:p-0">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/wholesale/stock" className="text-base underline">
          {t('wh.print.back')}
        </Link>
        <PrintButton label={t('wh.print.print')} />
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <h1 className="text-2xl font-semibold" dir="auto">
            {actor!.restaurantName}
          </h1>
          <p className="text-base text-muted">{t('wh.stock.sheet')}</p>
        </div>
        <dl className="text-base">
          <div className="flex gap-2">
            <dt className="text-muted">{t('wh.stock.warehouse')}</dt>
            <dd className="font-semibold" dir="auto">
              {title}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">{t('wh.print.date')}</dt>
            <dd className="tabular-nums" dir="ltr">
              {baghdadDate()}
            </dd>
          </div>
        </dl>
      </header>
      <table className="w-full text-base">
        <thead className="border-b border-line text-sm text-muted">
          <tr>
            <th scope="col" className="w-10 py-2 text-start font-medium">#</th>
            <th scope="col" className="py-2 text-start font-medium">{t('wh.purchases.item')}</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">{t('wh.stock.qty')}</th>
            {showCost && <th scope="col" className="px-3 py-2 text-end font-medium">{t('wh.home.stockValue')}</th>}
            <th scope="col" className="w-28 py-2 text-end font-medium">{t('wh.stock.counted')}</th>
          </tr>
        </thead>
        <tbody>
          {mine.map((r, i) => (
            <tr key={r.itemId} className="border-b border-line">
              <td className="py-1.5 tabular-nums text-muted">{i + 1}</td>
              <td className="py-1.5" dir="auto">
                {nameOf(r.itemNames as Names, locale)} <span className="text-sm text-muted" dir="ltr">{r.itemCode}</span>
              </td>
              <td className="px-3 py-1.5 text-end font-semibold tabular-nums" dir="ltr">
                {num(r.qtyBase)} <span className="text-sm font-normal text-muted">{t(`wh.unit.${r.baseUnit}`)}</span>
              </td>
              {showCost && (
                <td className="px-3 py-1.5 text-end tabular-nums" dir="ltr">
                  {num(String(value(r)))}
                </td>
              )}
              <td className="py-1.5" />
            </tr>
          ))}
        </tbody>
        {showCost && (
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={3} className="py-2">{t('wh.home.stockValue')} (IQD)</td>
              <td className="py-2 text-end tabular-nums" dir="ltr">{num(String(total))}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
      <p className="text-base text-muted">{mine.length} {t('wh.stock.itemsCount')}</p>
      <footer className="mt-8 grid grid-cols-2 gap-10 text-base">
        <div className="border-t border-ink pt-2">{t('wh.print.sellerSign')}</div>
        <div className="border-t border-ink pt-2">{t('wh.stock.checkerSign')}</div>
      </footer>
    </div>
  );
}
