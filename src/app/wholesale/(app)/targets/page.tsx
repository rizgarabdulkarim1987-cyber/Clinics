import type { Metadata } from 'next';
import Link from 'next/link';
import { addDays } from '@/server/domain/wholesale/forecast';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { isMonth } from '@/server/domain/wholesale/targets';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { itemsQuery } from '@/server/wholesale/queries/catalog';
import { repTargetsQuery } from '@/server/wholesale/queries/targets';
import { getStudioTranslator } from '@/studio/messages';
import { PageHeader } from '../../_ui/PageHeader';
import { TargetBars } from '../../_ui/TargetBars';
import { TargetForm } from '../../_ui/TargetForm';

export const metadata: Metadata = { title: 'Targets' };

type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;
const shiftMonth = (month: string, by: number) => addDays(`${month}-15`, by * 30).slice(0, 7);

/** Each rep's monthly targets (amount, weight, pieces, items) with how far the month has gone, and the form to set them. */
export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const locale = actor!.locale;
  const month = m && isMonth(m) ? m : baghdadDate().slice(0, 7);
  const [data, items] = await Promise.all([queryWh(repTargetsQuery, { month }), queryWh(itemsQuery)]);
  const options = items
    .filter((i) => i.active)
    .map((i) => ({ id: i.id, label: nameOf(i.names as Names, locale), unit: t(`wh.unit.${i.baseUnit}`) }));
  return (
    <>
      <PageHeader
        title={t('wh.target.title')}
        description={t('wh.target.description')}
        actions={
          <div className="flex items-center gap-1" dir="ltr">
            <Link href={`?m=${shiftMonth(month, -1)}`} className="grid h-8 w-8 place-items-center rounded-md border border-line-strong bg-raised hover:bg-hover" aria-label="-">
              ‹
            </Link>
            <span className="min-w-20 text-center text-base font-semibold tabular-nums">{month}</span>
            <Link href={`?m=${shiftMonth(month, 1)}`} className="grid h-8 w-8 place-items-center rounded-md border border-line-strong bg-raised hover:bg-hover" aria-label="+">
              ›
            </Link>
          </div>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-4 md:px-6">
        {data.reps.length === 0 ? (
          <p className="rounded-lg border border-line bg-raised px-4 py-6 text-center text-base text-muted">{t('wh.target.noReps')}</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.reps.map((r) => (
              <section key={r.userId} className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-4 shadow-[0_1px_2px_rgb(15_42_74/0.06)]">
                <h2 className="text-md font-semibold" dir="auto">
                  {r.name}
                </h2>
                <TargetBars row={r} pace={data.progress} t={t} locale={locale} />
                <details className="rounded-md border border-line" open={!r.target}>
                  <summary className="flex min-h-9 cursor-pointer items-center px-3 text-base font-semibold">{t('wh.target.edit')}</summary>
                  <div className="border-t border-line p-3">
                    {!r.target && r.last && <p className="pb-2 text-sm text-muted">{t('wh.target.fromLast')}</p>}
                    <TargetForm userId={r.userId} month={month} initial={r.target ?? r.last} items={options} key={`${r.userId}-${month}-${r.target ? 'x' : 'n'}`} />
                  </div>
                </details>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
