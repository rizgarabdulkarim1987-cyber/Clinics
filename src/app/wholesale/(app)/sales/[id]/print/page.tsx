import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { customersQuery } from '@/server/wholesale/queries/catalog';
import { saleQuery } from '@/server/wholesale/queries/sale';
import { getStudioTranslator } from '@/studio/messages';
import { FitReceipt } from '../../../../_ui/FitReceipt';
import { PrintButton } from '../../../../_ui/PrintButton';

export const metadata: Metadata = { title: 'Invoice' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

/** A clean invoice to print or save as PDF: the company, the customer, the lines, the total, and room to sign. */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ w?: string }> }) {
  const { id } = await params;
  const narrow = (await searchParams).w === '80';
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const s = await queryWh(saleQuery, { id });
  // a cancelled or refused invoice has no receipt
  if (!s || (s.status !== 'POSTED' && s.status !== 'PENDING_APPROVAL')) notFound();
  const shop = (await queryWh(customersQuery).catch(() => [])).find((c) => c.id === s.customer.id);
  if (narrow) {
    // an 80 mm thermal receipt: one narrow column, the item on its own line, quantity x price = total under it
    return (
      <div data-receipt className="mx-auto flex w-[72mm] max-w-full flex-col gap-2 bg-white p-2 text-[13px] leading-snug text-black print:p-0">
        <FitReceipt />
        <div data-screen-only className="flex items-center justify-between gap-2 print:hidden">
          <Link href={`/wholesale/sales/${s.id}/print`} className="text-sm underline">
            {t('wh.print.a4')}
          </Link>
          <PrintButton label={t('wh.print.print')} />
        </div>
        <header className="border-b border-dashed border-black pb-2 text-center">
          <h1 className="text-base font-bold" dir="auto">
            {actor!.restaurantName}
          </h1>
          <p>{t('wh.print.invoice')} <span dir="ltr">#{s.number}</span></p>
          <p dir="ltr">{s.date}</p>
        </header>
        <p>
          <span>{t('wh.print.customer')}: </span>
          <strong dir="auto">{s.customer.name}</strong>
          <span className="block">{s.paymentMode === 'CREDIT' ? t('wh.purchases.credit') : t('wh.purchases.cash')}</span>
        </p>
        <ul className="flex flex-col border-y border-dashed border-black">
          {s.lines.map((l) => (
            <li key={l.id} className="border-b border-dotted border-black py-1 last:border-b-0">
              <span className="block font-semibold" dir="auto">
                {nameOf(l.itemNames as Names, actor!.locale)}
              </span>
              <span className="flex justify-between tabular-nums" dir="ltr">
                <span>
                  {money(l.qty)} {t(`wh.unit.${l.unit}`)} x {money(l.finalPrice)}
                </span>
                <strong>{money(l.lineTotal)}</strong>
              </span>
            </li>
          ))}
        </ul>
        {Number(s.totalDiscount) !== 0 && (
          <p className="flex justify-between">
            <span>{t('wh.sales.discount')}</span>
            <span className="tabular-nums" dir="ltr">
              {money(s.totalDiscount)} {s.currency}
            </span>
          </p>
        )}
        <p className="flex justify-between text-base font-bold">
          <span>{t('wh.purchases.total')}</span>
          <span className="tabular-nums" dir="ltr">
            {money(s.totalFinal)} {s.currency}
          </span>
        </p>
        {s.seller && (
          <p className="text-center text-xs" dir="auto">
            {s.seller.name}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 bg-white p-4 text-black md:p-8 print:max-w-none print:p-0">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/wholesale/sales/${s.id}`} className="text-base underline">
          {t('wh.print.back')}
        </Link>
        <span className="flex items-center gap-3">
          <Link href={`/wholesale/sales/${s.id}/print?w=80`} className="text-base underline">
            {t('wh.print.thermal')}
          </Link>
          <PrintButton label={t('wh.print.print')} />
        </span>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <h1 className="text-2xl font-semibold" dir="auto">
            {actor!.restaurantName}
          </h1>
          <p className="text-base text-muted">{t('wh.print.invoice')}</p>
        </div>
        <dl className="text-base">
          <div className="flex gap-2">
            <dt className="text-muted">{t('wh.sales.number')}</dt>
            <dd className="font-semibold tabular-nums" dir="ltr">
              {s.number}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">{t('wh.print.date')}</dt>
            <dd className="tabular-nums" dir="ltr">
              {s.date}
            </dd>
          </div>
          {s.seller && (
            <div className="flex gap-2">
              <dt className="text-muted">{t('wh.sales.seller')}</dt>
              <dd dir="auto">
                {s.seller.name} ({t(`wh.role.${s.seller.role}`)})
              </dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="text-muted">{t('wh.print.payment')}</dt>
            <dd>{s.paymentMode === 'CREDIT' ? t('wh.purchases.credit') : t('wh.purchases.cash')}</dd>
          </div>
        </dl>
      </header>
      <p className="text-md">
        <span className="text-muted">{t('wh.print.customer')}: </span>
        <span className="font-semibold" dir="auto">
          {s.customer.name}
        </span>
        {shop && (
          <span className="block text-base text-muted" dir="auto">
            {[shop.ownerName, shop.phone, shop.address].filter(Boolean).join(' · ')}
          </span>
        )}
      </p>
      <table className="w-full text-base">
        <thead className="border-b border-line text-sm text-muted">
          <tr>
            <th scope="col" className="py-2 text-start font-medium">{t('wh.purchases.item')}</th>
            <th scope="col" className="py-2 text-end font-medium">{t('wh.purchases.qty')}</th>
            <th scope="col" className="py-2 text-end font-medium">{t('wh.purchases.unitPrice')}</th>
            <th scope="col" className="py-2 text-end font-medium">{t('wh.purchases.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className="py-2" dir="auto">
                {nameOf(l.itemNames as Names, actor!.locale)}
              </td>
              <td className="py-2 text-end tabular-nums" dir="ltr">
                {money(l.qty)} {t(`wh.unit.${l.unit}`)}
              </td>
              <td className="py-2 text-end tabular-nums" dir="ltr">
                {money(l.finalPrice)}
              </td>
              <td className="py-2 text-end tabular-nums" dir="ltr">
                {money(l.lineTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ms-auto flex w-full max-w-xs flex-col gap-1 text-base">
        {Number(s.totalDiscount) !== 0 && (
          <div className="flex justify-between">
            <dt className="text-muted">{t('wh.sales.discount')}</dt>
            <dd className="tabular-nums" dir="ltr">
              {money(s.totalDiscount)} {s.currency}
            </dd>
          </div>
        )}
        <div className="flex justify-between border-t border-ink pt-2 text-lg font-semibold">
          <dt>{t('wh.purchases.total')}</dt>
          <dd className="tabular-nums" dir="ltr">
            {money(s.totalFinal)} {s.currency}
          </dd>
        </div>
      </dl>
      <div className="mt-10 grid grid-cols-2 gap-8 text-sm text-muted">
        <p className="border-t border-line-strong pt-2">{t('wh.print.sellerSign')}</p>
        <p className="border-t border-line-strong pt-2">{t('wh.print.buyerSign')}</p>
      </div>
    </div>
  );
}
