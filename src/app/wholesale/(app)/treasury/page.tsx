import type { Metadata } from 'next';
import { canWh } from '@/server/domain/wholesale/permissions';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { conversionsQuery, myCustodyQuery, pendingHandoversQuery } from '@/server/wholesale/queries/treasury';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, PageHeader } from '@/studio/ui';
import { ConfirmHandover, ConvertForm, HandoverForm } from '../../_ui/TreasuryForms';

export const metadata: Metadata = { title: 'Treasury' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

export default async function TreasuryPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const isRep = actor!.role === 'REP';
  const manage = canWh(actor!.role, 'treasury.manage');
  const [custody, pending, conversions] = await Promise.all([
    queryWh(myCustodyQuery),
    canWh(actor!.role, 'custody.confirm') ? queryWh(pendingHandoversQuery) : Promise.resolve([]),
    manage ? queryWh(conversionsQuery) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={t('wh.treasury.title')} description={isRep ? t('wh.treasury.descriptionRep') : t('wh.treasury.description')} />
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        {isRep && (
          <>
            <section className="flex flex-wrap gap-x-8 gap-y-2 rounded-md border border-line bg-raised p-4">
              {custody.length === 0 ? (
                <p className="text-base text-muted">{t('wh.handover.nothing')}</p>
              ) : (
                custody.map((c) => (
                  <div key={c.currency}>
                    <p className="text-sm text-muted">{t(`wh.currency.${c.currency}`)}</p>
                    <p className="text-md font-semibold tabular-nums" dir="ltr">
                      {money(c.balance)}
                    </p>
                    {Number(c.reserved) > 0 && <p className="text-sm text-muted">{t('wh.handover.reserved')} {money(c.reserved)}</p>}
                  </div>
                ))
              )}
            </section>
            <section className="rounded-md border border-line bg-raised p-4">
              <h2 className="mb-3 text-md font-semibold">{t('wh.handover.title')}</h2>
              <HandoverForm available={custody.filter((c) => Number(c.available) > 0).map((c) => ({ currency: c.currency, available: c.available }))} />
            </section>
          </>
        )}
        {pending.length > 0 && (
          <section className="flex flex-col gap-4 rounded-md border border-line bg-raised p-4">
            <h2 className="text-md font-semibold">{t('wh.handover.pending')}</h2>
            {pending.map((h) => (
              <div key={h.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
                <p className="text-base">#{h.number}</p>
                <ConfirmHandover handoverId={h.id} lines={h.lines.map((l) => ({ currency: l.currency, submitted: l.submitted }))} />
              </div>
            ))}
          </section>
        )}
        {manage && (
          <>
            <details className="rounded-md border border-line bg-raised">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.treasury.convert')}</summary>
              <div className="border-t border-line p-4">
                <ConvertForm today={baghdadDate()} />
              </div>
            </details>
            {conversions.length === 0 ? (
              <EmptyState title={t('wh.treasury.noConversions')} />
            ) : (
              <ul className="flex flex-col gap-3">
                {conversions.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-line bg-raised p-4">
                    <span className="text-base" dir="ltr">
                      #{c.number} · {c.date}
                    </span>
                    <span className="text-base font-semibold tabular-nums" dir="ltr">
                      {money(c.fromAmount)} {c.fromCurrency} → {money(c.toAmount)} {c.toCurrency}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}
