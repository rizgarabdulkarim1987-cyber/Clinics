import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { purchaseQuery } from '@/server/wholesale/queries/purchase';
import { getStudioTranslator } from '@/studio/messages';
import { StatusBadge } from '@/studio/ui';
import { PageHeader } from '../../../_ui/PageHeader';
import { CancelPurchaseForm, LandedCostForm, PayForm, ReturnPurchaseForm } from '../../../_ui/PurchaseForms';

export const metadata: Metadata = { title: 'Purchase' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const p = await queryWh(purchaseQuery, { id });
  if (!p) notFound();
  const today = baghdadDate();
  const live = p.status === 'POSTED';
  return (
    <>
      <PageHeader title={`${t('wh.purchases.number')} ${p.number}`} description={`${p.supplier.name} · ${p.date}`} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        <section className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-md border border-line bg-raised p-4">
          <div>
            <p className="text-sm text-muted">{t('wh.purchases.total')}</p>
            <p className="text-md font-semibold tabular-nums" dir="ltr">
              {money(p.totalOriginal)} {p.currency}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">{t('wh.purchases.totalIqd')}</p>
            <p className="text-md font-semibold tabular-nums" dir="ltr">
              {money(p.totalIqd)} IQD
            </p>
          </div>
          {p.paymentMode === 'CREDIT' && (
            <div>
              <p className="text-sm text-muted">{t('wh.purchases.open')}</p>
              <p className="text-md font-semibold tabular-nums" dir="ltr">
                {money(p.open)} {p.currency}
              </p>
            </div>
          )}
          <StatusBadge tone={live ? 'ink' : 'neutral'}>{live ? t('wh.purchases.statusPosted') : t('wh.purchases.statusCancelled')}</StatusBadge>
          <Link href={`/wholesale/suppliers/${p.supplier.id}`} className="text-base underline">
            {t('wh.purchases.statement')}
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
              {p.lines.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2" dir="auto">
                    {nameOf(l.itemNames, actor!.locale)} <span className="text-muted">· {l.itemCode}</span>
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums" dir="ltr">
                    {money(l.qty)} {t(`wh.unit.${l.unit}`)}
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums" dir="ltr">{money(l.unitPrice)}</td>
                  <td className="px-4 py-2 text-end tabular-nums" dir="ltr">{money(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {(p.landedCosts.length > 0 || p.payments.length > 0 || p.returns.length > 0) && (
          <section className="flex flex-col gap-2 rounded-md border border-line bg-raised p-4">
            {p.landedCosts.map((c) => (
              <p key={c.id} className="text-base" dir="auto">
                {t('wh.purchases.landed')}: {t(`wh.cost.${c.kind}`)} ·{' '}
                <span dir="ltr">
                  {money(c.amount)} {c.currency} · {c.date}
                </span>
              </p>
            ))}
            {p.payments.map((x) => (
              <p key={x.id} className="text-base" dir="auto">
                {t('wh.pay.title')}:{' '}
                <span dir="ltr">
                  {money(x.amount)} {x.currency} · {x.date}
                </span>
              </p>
            ))}
            {p.returns.map((r) => (
              <p key={r.id} className="text-base" dir="auto">
                {t('wh.purchases.returnButton')}:{' '}
                <span dir="ltr">
                  {money(r.totalValue)} {r.currency} · {r.date}
                </span>
              </p>
            ))}
          </section>
        )}
        {p.status === 'CANCELLED' && p.cancelReason && (
          <p className="text-base text-muted" dir="auto">
            {p.cancelReason}
          </p>
        )}

        {live && (
          <div className="flex flex-col gap-3">
            <details className="rounded-md border border-line bg-raised">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.purchases.addCost')}</summary>
              <div className="border-t border-line p-4">
                <LandedCostForm purchaseId={p.id} currency={p.currency} today={today} />
              </div>
            </details>
            {p.paymentMode === 'CREDIT' && (
              <details className="rounded-md border border-line bg-raised">
                <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.pay.title')}</summary>
                <div className="border-t border-line p-4">
                  <PayForm supplierId={p.supplier.id} purchaseId={p.id} currency={p.currency} today={today} />
                </div>
              </details>
            )}
            <details className="rounded-md border border-line bg-raised">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.purchases.returnButton')}</summary>
              <div className="border-t border-line p-4">
                <ReturnPurchaseForm
                  purchaseId={p.id}
                  paymentMode={p.paymentMode}
                  lines={p.lines.map((l) => ({ id: l.id, label: nameOf(l.itemNames, actor!.locale), unit: l.unit, qty: money(l.qty) }))}
                />
              </div>
            </details>
            <details className="rounded-md border border-line bg-raised">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.purchases.cancel')}</summary>
              <div className="border-t border-line p-4">
                <CancelPurchaseForm purchaseId={p.id} />
              </div>
            </details>
          </div>
        )}
      </div>
    </>
  );
}
