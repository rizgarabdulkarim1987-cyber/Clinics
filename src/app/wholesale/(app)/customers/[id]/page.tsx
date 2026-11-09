import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { customersQuery } from '@/server/wholesale/queries/catalog';
import { customerStatementQuery } from '@/server/wholesale/queries/sale';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, PageHeader } from '@/studio/ui';
import { CollectForm } from '../../../_ui/SaleForms';

export const metadata: Metadata = { title: 'Customer statement' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

export default async function CustomerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const customer = (await queryWh(customersQuery)).find((c) => c.id === id);
  if (!customer) notFound();
  const { rows, balances } = await queryWh(customerStatementQuery, { id });
  return (
    <>
      <PageHeader title={customer.name} description={t('wh.cstatement.title')} />
      <div className="px-4 pb-3 md:px-8">
        <Link href={`/wholesale/customers/${id}/print`} className="text-base underline">
          {t('wh.print.statementOpen')}
        </Link>
      </div>
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        <section className="flex flex-wrap gap-x-8 gap-y-2 rounded-md border border-line bg-raised p-4">
          {Object.keys(balances).length === 0 ? (
            <p className="text-base text-muted">{t('wh.cstatement.settled')}</p>
          ) : (
            Object.entries(balances).map(([currency, amount]) => (
              <div key={currency}>
                <p className="text-sm text-muted">{t('wh.cstatement.owed')}</p>
                <p className="text-md font-semibold tabular-nums" dir="ltr">
                  {money(String(amount))} {currency}
                </p>
              </div>
            ))
          )}
        </section>
        <details className="rounded-md border border-line bg-raised">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.collect.title')}</summary>
          <div className="border-t border-line p-4">
            <CollectForm customerId={id} currency="IQD" today={baghdadDate()} isRep={actor!.role === 'REP'} />
          </div>
        </details>
        {rows.length === 0 ? (
          <EmptyState title={t('wh.statement.empty')} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-raised">
            <table className="w-full text-base">
              <caption className="sr-only">{t('wh.cstatement.title')}</caption>
              <thead className="border-b border-line text-sm text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('wh.purchases.date')}</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('wh.statement.what')}</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">{t('wh.cstatement.charge')}</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">{t('wh.statement.paid')}</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">{t('wh.statement.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-4 py-2" dir="ltr">{r.date}</td>
                    <td className="px-4 py-2">
                      {r.saleId ? (
                        <Link href={`/wholesale/sales/${r.saleId}`} className="underline">
                          {t(`wh.cstatement.kind.${r.kind}`)} #{r.saleNumber}
                        </Link>
                      ) : (
                        t(`wh.cstatement.kind.${r.kind}`)
                      )}
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums" dir="ltr">{Number(r.charge) ? `${money(r.charge)} ${r.currency}` : ''}</td>
                    <td className="px-4 py-2 text-end tabular-nums" dir="ltr">{Number(r.paid) ? `${money(r.paid)} ${r.currency}` : ''}</td>
                    <td className="px-4 py-2 text-end tabular-nums" dir="ltr">
                      {money(r.balance)} {r.currency}
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
