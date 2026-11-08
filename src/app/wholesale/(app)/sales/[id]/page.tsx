import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canWh } from '@/server/domain/wholesale/permissions';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { itemsQuery } from '@/server/wholesale/queries/catalog';
import { saleQuery } from '@/server/wholesale/queries/sale';
import { getStudioTranslator } from '@/studio/messages';
import { PageHeader, StatusBadge } from '@/studio/ui';
import { CancelSaleForm, CollectForm, ReturnSaleForm } from '../../../_ui/SaleForms';

export const metadata: Metadata = { title: 'Sale' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const s = await queryWh(saleQuery, { id });
  if (!s) notFound();
  const items = await queryWh(itemsQuery);
  const isRep = actor!.role === 'REP';
  const today = baghdadDate();
  const live = s.status === 'POSTED';
  const showCost = canWh(actor!.role, 'cost.view') && 'totalCostIqd' in s;
  return (
    <>
      <PageHeader title={`${t('wh.sales.number')} ${s.number}`} description={`${s.customer.name} · ${s.date}`} />
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        <section className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-md border border-line bg-raised p-4">
          <div>
            <p className="text-sm text-muted">{t('wh.purchases.total')}</p>
            <p className="text-md font-semibold tabular-nums" dir="ltr">
              {money(s.totalFinal)} {s.currency}
            </p>
          </div>
          {Number(s.totalDiscount) !== 0 && (
            <div>
              <p className="text-sm text-muted">{t('wh.sales.discount')}</p>
              <p className="text-md font-semibold tabular-nums" dir="ltr">
                {money(s.totalDiscount)} {s.currency}
              </p>
            </div>
          )}
          {s.paymentMode === 'CREDIT' && (
            <div>
              <p className="text-sm text-muted">{t('wh.purchases.open')}</p>
              <p className="text-md font-semibold tabular-nums" dir="ltr">
                {money(s.open)} {s.currency}
              </p>
            </div>
          )}
          {showCost && (
            <div>
              <p className="text-sm text-muted">{t('wh.sales.cost')}</p>
              <p className="text-md font-semibold tabular-nums" dir="ltr">
                {money((s as { totalCostIqd?: string | null }).totalCostIqd ?? '0')} IQD
              </p>
            </div>
          )}
          <StatusBadge tone={live ? 'ink' : 'neutral'}>{t(`wh.sales.status.${s.status}`)}</StatusBadge>
          <Link href={`/wholesale/customers/${s.customer.id}`} className="text-base underline">
            {t('wh.sales.statement')}
          </Link>
        </section>

        <section className="overflow-x-auto rounded-md border border-line bg-raised">
          <table className="w-full text-base">
            <caption className="sr-only">{t('wh.purchases.lines')}</caption>
            <thead className="border-b border-line text-sm text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-medium">{t('wh.purchases.item')}</th>
                <th scope="col" className="px-4 py-2 text-end font-medium">{t('wh.purchases.qty')}</th>
                <th scope="col" className="px-4 py-2 text-end font-medium">{t('wh.purchases.unitPrice')}</th>
                <th scope="col" className="px-4 py-2 text-end font-medium">{t('wh.purchases.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2" dir="auto">
                    {nameOf(l.itemNames as Names, actor!.locale)} <span className="text-muted">· {l.itemCode}</span>
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums" dir="ltr">
                    {money(l.qty)} {t(`wh.unit.${l.unit}`)}
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums" dir="ltr">{money(l.finalPrice)}</td>
                  <td className="px-4 py-2 text-end tabular-nums" dir="ltr">{money(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {s.payments.length > 0 && (
          <section className="flex flex-col gap-2 rounded-md border border-line bg-raised p-4">
            {s.payments.map((x, i) => (
              <p key={i} className="text-base" dir="auto">
                {t('wh.collect.title')}:{' '}
                <span dir="ltr">
                  {money(x.amount)} {x.currency} · {x.date}
                </span>
              </p>
            ))}
          </section>
        )}
        {s.statusReason && (
          <p className="text-base text-muted" dir="auto">
            {s.statusReason}
          </p>
        )}

        {live && (
          <div className="flex flex-col gap-3">
            {s.paymentMode === 'CREDIT' && (
              <details className="rounded-md border border-line bg-raised">
                <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.collect.title')}</summary>
                <div className="border-t border-line p-4">
                  <CollectForm customerId={s.customer.id} saleId={s.id} currency={s.currency} today={today} isRep={isRep} />
                </div>
              </details>
            )}
            {canWh(actor!.role, 'sale.return') && (
              <details className="rounded-md border border-line bg-raised">
                <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.sales.returnButton')}</summary>
                <div className="border-t border-line p-4">
                  <ReturnSaleForm
                    saleId={s.id}
                    paymentMode={s.paymentMode}
                    lines={s.lines.map((l) => ({ id: l.id, label: nameOf(l.itemNames as Names, actor!.locale), unit: l.unit, qty: money(l.qty) }))}
                    items={items.filter((i) => i.active).map((i) => ({ id: i.id, label: `${nameOf(i.names, actor!.locale)} · ${i.code}`, units: [...new Set([i.baseUnit, ...i.units.map((u) => u.unit)])] }))}
                  />
                </div>
              </details>
            )}
            {canWh(actor!.role, 'sale.override') && (
              <details className="rounded-md border border-line bg-raised">
                <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.sales.cancel')}</summary>
                <div className="border-t border-line p-4">
                  <CancelSaleForm saleId={s.id} />
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </>
  );
}
