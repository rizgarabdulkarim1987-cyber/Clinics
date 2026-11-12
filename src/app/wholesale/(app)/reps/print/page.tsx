import type { Metadata } from 'next';
import Link from 'next/link';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { stockQuery, warehousesQuery } from '@/server/wholesale/queries/catalog';
import { salesQuery } from '@/server/wholesale/queries/sale';
import { repAccountsQuery } from '@/server/wholesale/queries/treasury';
import { getStudioTranslator } from '@/studio/messages';
import { PrintButton } from '../../../_ui/PrintButton';
import { moveLabel } from '../../../_ui/repMoves';

export const metadata: Metadata = { title: 'Reps report' };

const money = (v: string | number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

/** The report to print or save as PDF: every rep and the cash he holds, or (with ?rep=) one rep's full statement with a place to sign. */
export default async function RepsPrintPage({ searchParams }: { searchParams: Promise<{ rep?: string }> }) {
  const { rep } = await searchParams;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const reps = await queryWh(repAccountsQuery, rep ? { repId: rep, limit: 2000 } : { limit: 1 });
  const one = rep ? reps[0] : undefined;
  // the goods he carries: his own warehouse's stock, so the statement shows both the cash and the stock he is answerable for
  const [warehouses, stock, allSales] = one ? await Promise.all([queryWh(warehousesQuery), queryWh(stockQuery), queryWh(salesQuery, { sellerId: rep })]) : [[], [], []];
  const sales = allSales.filter((x) => x.status === 'POSTED');
  const soldBy = new Map<string, number>();
  for (const x of sales) soldBy.set(x.currency, (soldBy.get(x.currency) ?? 0) + Number(x.totalFinal));
  const myWh = warehouses.find((x) => x.repUserId === rep);
  const carried = myWh ? stock.filter((r) => r.warehouseId === myWh.id && Number(r.qtyBase) !== 0) : [];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 bg-white p-4 text-black md:p-8 print:max-w-none print:p-0">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/wholesale/reps" className="text-base underline">
          {t('wh.print.back')}
        </Link>
        <PrintButton label={t('wh.print.print')} />
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <h1 className="text-2xl font-semibold" dir="auto">
            {actor!.restaurantName}
          </h1>
          <p className="text-base text-muted">{one ? t('wh.reps.print.statement') : t('wh.reps.print.title')}</p>
        </div>
        <dl className="text-base">
          <div className="flex gap-2">
            <dt className="text-muted">{t('wh.print.date')}</dt>
            <dd className="tabular-nums" dir="ltr">
              {baghdadDate()}
            </dd>
          </div>
          {one && (
            <div className="flex gap-2">
              <dt className="text-muted">{t('wh.reps.print.name')}</dt>
              <dd className="font-semibold" dir="auto">
                {one.name}
              </dd>
            </div>
          )}
        </dl>
      </header>
      {one ? (
        <>
          <table className="w-full text-base">
            <thead className="border-b border-line text-sm text-muted">
              <tr>
                <th scope="col" className="py-2 text-start font-medium">{t('wh.reps.print.when')}</th>
                <th scope="col" className="py-2 text-start font-medium">{t('wh.reps.print.what')}</th>
                <th scope="col" className="py-2 text-end font-medium">{t('wh.reps.print.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {[...one.moves].reverse().map((m, i) => (
                <tr key={`${m.number}-${i}`} className="border-b border-line">
                  <td className="py-2 tabular-nums" dir="ltr">
                    {m.date}
                  </td>
                  <td className="py-2" dir="auto">
                    {moveLabel(m, t)}
                  </td>
                  <td className="py-2 text-end tabular-nums" dir="ltr">
                    {m.side === 'DR' ? '+' : '−'}
                    {money(m.amount)} {m.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sales.length > 0 && (
            <table className="w-full text-base">
              <caption className="pb-2 text-start text-sm font-medium text-muted">{t('wh.reps.print.sales')}</caption>
              <thead className="border-b border-line text-sm text-muted">
                <tr>
                  <th scope="col" className="py-2 text-start font-medium">{t('wh.reps.print.when')}</th>
                  <th scope="col" className="py-2 text-start font-medium">{t('wh.sales.customer')}</th>
                  <th scope="col" className="py-2 text-start font-medium">{t('wh.purchases.cash')} / {t('wh.purchases.credit')}</th>
                  <th scope="col" className="py-2 text-end font-medium">{t('wh.purchases.total')}</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((x) => (
                  <tr key={x.id} className="border-b border-line">
                    <td className="py-1.5 tabular-nums" dir="ltr">{x.date}</td>
                    <td className="py-1.5" dir="auto">{x.customer.name}</td>
                    <td className="py-1.5">{x.paymentMode === 'CREDIT' ? t('wh.purchases.credit') : t('wh.purchases.cash')}</td>
                    <td className="py-1.5 text-end tabular-nums" dir="ltr">{money(x.totalFinal)} {x.currency}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={3} className="py-2">{t('wh.purchases.total')}</td>
                  <td className="py-2 text-end tabular-nums" dir="ltr">{[...soldBy].map(([c, v]) => `${money(v)} ${c}`).join(' · ')}</td>
                </tr>
              </tfoot>
            </table>
          )}
          {carried.length > 0 && (
            <table className="w-full text-base">
              <caption className="pb-2 text-start text-sm font-medium text-muted">{t('wh.reps.print.stock')}</caption>
              <thead className="border-b border-line text-sm text-muted">
                <tr>
                  <th scope="col" className="py-2 text-start font-medium">{t('wh.purchases.item')}</th>
                  <th scope="col" className="py-2 text-end font-medium">{t('wh.stock.qty')}</th>
                </tr>
              </thead>
              <tbody>
                {carried.map((r) => (
                  <tr key={r.itemId} className="border-b border-line">
                    <td className="py-1.5" dir="auto">
                      {nameOf(r.itemNames as Names, actor!.locale)} <span className="text-sm text-muted" dir="ltr">{r.itemCode}</span>
                    </td>
                    <td className="py-1.5 text-end font-semibold tabular-nums" dir="ltr">
                      {money(r.qtyBase)} <span className="text-sm font-normal text-muted">{t(`wh.unit.${r.baseUnit}`)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <dl className="ms-auto flex w-full max-w-xs flex-col gap-1 border-t border-ink pt-2 text-lg font-semibold">
            <dt className="text-sm font-medium text-muted">{t('wh.reps.print.balance')}</dt>
            {one.custody.length === 0 ? (
              <dd className="tabular-nums">0</dd>
            ) : (
              one.custody.map((c) => (
                <dd key={c.currency} className="tabular-nums" dir="ltr">
                  {money(c.balance)} {c.currency}
                </dd>
              ))
            )}
          </dl>
          <div className="mt-10 grid grid-cols-2 gap-8 text-sm text-muted">
            <p className="border-t border-line-strong pt-2">{t('wh.reps.print.signRep')}</p>
            <p className="border-t border-line-strong pt-2">{t('wh.reps.print.signOffice')}</p>
          </div>
        </>
      ) : (
        <table className="w-full text-base">
          <thead className="border-b border-line text-sm text-muted">
            <tr>
              <th scope="col" className="py-2 text-start font-medium">{t('wh.reps.print.name')}</th>
              <th scope="col" className="py-2 text-end font-medium">{t('wh.reps.print.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <tr key={r.repId} className="border-b border-line">
                <td className="py-2" dir="auto">
                  {r.name}
                </td>
                <td className="py-2 text-end tabular-nums" dir="ltr">
                  {r.custody.length === 0 ? '0' : r.custody.map((c) => `${money(c.balance)} ${c.currency}`).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
