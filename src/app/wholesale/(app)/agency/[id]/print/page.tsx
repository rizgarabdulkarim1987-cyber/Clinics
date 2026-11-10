import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { agencyOrderQuery } from '@/server/wholesale/queries/agency';
import { getStudioTranslator } from '@/studio/messages';
import { PrintButton } from '../../../../_ui/PrintButton';

export const metadata: Metadata = { title: 'Agency order statement' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

/** A statement of one agency order to print or save as PDF: the steps, what was paid in advance, what is owed, room to sign. */
export default async function AgencyPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const o = await queryWh(agencyOrderQuery, { id });
  if (!o) notFound();
  const b = o.balance;
  const sum: [string, string][] = [
    [t('wh.agency.agreedTotal'), o.agreedTotal],
    [t('wh.agency.received'), b.advanceReceived],
    [t('wh.agency.costs'), b.costs],
    [t('wh.agency.commission'), b.commission],
    [t('wh.agency.held'), b.advanceHeld],
    [t('wh.agency.owed'), b.receivable],
  ];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 bg-white p-4 text-black md:p-8 print:max-w-none print:p-0">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/wholesale/agency/${o.id}`} className="text-base underline">
          {t('wh.print.back')}
        </Link>
        <PrintButton label={t('wh.print.print')} />
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <h1 className="text-2xl font-semibold" dir="auto">
            {actor!.restaurantName}
          </h1>
          <p className="text-base text-muted">{t('wh.agency.print.title')}</p>
        </div>
        <dl className="text-base">
          <div className="flex gap-2">
            <dt className="text-muted">{t('wh.agency.number')}</dt>
            <dd className="font-semibold tabular-nums" dir="ltr">
              {o.number}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">{t('wh.print.date')}</dt>
            <dd className="tabular-nums" dir="ltr">
              {String(o.date).slice(0, 10)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">{t('wh.agency.currency')}</dt>
            <dd dir="ltr">{o.currency}</dd>
          </div>
        </dl>
      </header>
      <p className="text-md">
        <span className="text-muted">{t('wh.agency.principal')}: </span>
        <span className="font-semibold" dir="auto">
          {o.principal.name}
        </span>
        <span className="block text-base text-muted" dir="auto">
          {[o.principal.ownerName, o.principal.phone, o.principal.address].filter(Boolean).join(' · ')}
        </span>
        <span className="block text-base" dir="auto">
          {o.title}
          {o.note ? ` — ${o.note}` : ''}
        </span>
      </p>
      <table className="w-full text-base">
        <thead className="border-b border-line text-sm text-muted">
          <tr>
            <th scope="col" className="py-2 text-start font-medium">{t('wh.print.date')}</th>
            <th scope="col" className="py-2 text-start font-medium">{t('wh.agency.history')}</th>
            <th scope="col" className="py-2 text-end font-medium">{t('wh.purchases.total')}</th>
          </tr>
        </thead>
        <tbody>
          {o.movements.map((m) => (
            <tr key={m.id} className="border-b border-line">
              <td className="py-2 tabular-nums" dir="ltr">
                {String(m.date).slice(0, 10)}
              </td>
              <td className="py-2" dir="auto">
                {t(`wh.agency.kind.${m.kind}`)}
                {m.note ? ` · ${m.note}` : ''}
              </td>
              <td className="py-2 text-end tabular-nums" dir="ltr">
                {money(m.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ms-auto flex w-full max-w-xs flex-col gap-1 text-base">
        <dt className="text-sm font-semibold">{t('wh.agency.print.summary')}</dt>
        {sum.map(([label, v], i) => (
          <div key={label} className={`flex justify-between ${i === sum.length - 1 ? 'border-t border-ink pt-2 text-lg font-semibold' : ''}`}>
            <dt className={i === sum.length - 1 ? '' : 'text-muted'}>{label}</dt>
            <dd className="tabular-nums" dir="ltr">
              {money(v)} {o.currency}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-10 grid grid-cols-2 gap-8 text-sm text-muted">
        <p className="border-t border-line-strong pt-2">{t('wh.agency.print.companySign')}</p>
        <p className="border-t border-line-strong pt-2">{t('wh.agency.print.principalSign')}</p>
      </div>
    </div>
  );
}
