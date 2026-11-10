import type { Metadata } from 'next';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { ratesQuery } from '@/server/wholesale/queries/purchase';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState } from '@/studio/ui';
import { PageHeader } from '../../_ui/PageHeader';
import { RateForm } from '../../_ui/PurchaseForms';

export const metadata: Metadata = { title: 'Exchange rates' };

export default async function RatesPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const { today, rates } = await queryWh(ratesQuery);
  const haveToday = new Set(rates.filter((r) => r.date === today).map((r) => r.currency));
  return (
    <>
      <PageHeader title={t('wh.rates.title')} description={t('wh.rates.description')} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        {(!haveToday.has('USD') || !haveToday.has('IRT')) && (
          <p role="status" className="rounded-md border border-line bg-raised p-4 text-base">
            {t('wh.rates.missingToday')}
          </p>
        )}
        <section className="rounded-md border border-line bg-raised p-4">
          <RateForm today={today} />
        </section>
        {rates.length === 0 ? (
          <EmptyState title={t('wh.rates.empty')} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-raised">
            <table className="w-full text-base">
              <caption className="sr-only">{t('wh.rates.title')}</caption>
              <thead className="border-b border-line text-sm text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('wh.rates.date')}</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('wh.rates.currency')}</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">{t('wh.rates.iqdPer')}</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={`${r.date}:${r.currency}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-2" dir="ltr">{r.date}</td>
                    <td className="px-4 py-2">{t(`wh.currency.${r.currency}`)}</td>
                    <td className="px-4 py-2 text-end tabular-nums" dir="ltr">
                      {Number(r.iqdPer).toLocaleString('en-US', { maximumFractionDigits: 8 })}
                    </td>
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
