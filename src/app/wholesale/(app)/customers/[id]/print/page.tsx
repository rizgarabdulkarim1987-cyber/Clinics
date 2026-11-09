import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { customersQuery } from '@/server/wholesale/queries/catalog';
import { customerStatementQuery } from '@/server/wholesale/queries/sale';
import { getStudioTranslator } from '@/studio/messages';
import { PrintButton } from '../../../../_ui/PrintButton';

export const metadata: Metadata = { title: 'Account statement' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

/** The customer's account on paper: every sale, payment and return with the running balance. To hand over or save as PDF. */
export default async function StatementPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const customer = (await queryWh(customersQuery)).find((c) => c.id === id);
  if (!customer) notFound();
  const { rows, balances } = await queryWh(customerStatementQuery, { id });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-8">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/wholesale/customers/${id}`} className="text-base underline">
          {t('wh.print.back')}
        </Link>
        <PrintButton label={t('wh.print.print')} />
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <h1 className="text-2xl font-semibold" dir="auto">
            {actor!.restaurantName}
          </h1>
          <p className="text-base text-muted">{t('wh.print.statement')}</p>
        </div>
        <dl className="text-base">
          <div className="flex gap-2">
            <dt className="text-muted">{t('wh.print.customer')}</dt>
            <dd className="font-semibold" dir="auto">
              {customer.name}
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
            <th scope="col" className="py-2 text-start font-medium">{t('wh.print.date')}</th>
            <th scope="col" className="py-2 text-start font-medium">{t('wh.statement.what')}</th>
            <th scope="col" className="py-2 text-end font-medium">{t('wh.cstatement.charge')}</th>
            <th scope="col" className="py-2 text-end font-medium">{t('wh.statement.paid')}</th>
            <th scope="col" className="py-2 text-end font-medium">{t('wh.statement.balance')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line">
              <td className="py-2 tabular-nums" dir="ltr">
                {r.date}
              </td>
              <td className="py-2">
                {t(`wh.cstatement.kind.${r.kind}`)}
                {r.saleNumber ? ` #${r.saleNumber}` : ''}
              </td>
              <td className="py-2 text-end tabular-nums" dir="ltr">
                {Number(r.charge) ? `${money(r.charge)} ${r.currency}` : ''}
              </td>
              <td className="py-2 text-end tabular-nums" dir="ltr">
                {Number(r.paid) ? `${money(r.paid)} ${r.currency}` : ''}
              </td>
              <td className="py-2 text-end tabular-nums" dir="ltr">
                {money(r.balance)} {r.currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ms-auto flex w-full max-w-xs flex-col gap-1 border-t border-ink pt-2 text-lg font-semibold">
        {Object.keys(balances).length === 0 ? (
          <p>{t('wh.cstatement.settled')}</p>
        ) : (
          Object.entries(balances).map(([cur, v]) => (
            <p key={cur} className="flex justify-between">
              <span>{t('wh.cstatement.owed')}</span>
              <span className="tabular-nums" dir="ltr">
                {money(String(v))} {cur}
              </span>
            </p>
          ))
        )}
      </div>
      <div className="mt-10 grid grid-cols-2 gap-8 text-sm text-muted">
        <p className="border-t border-line-strong pt-2">{t('wh.print.sellerSign')}</p>
        <p className="border-t border-line-strong pt-2">{t('wh.print.buyerSign')}</p>
      </div>
    </div>
  );
}
