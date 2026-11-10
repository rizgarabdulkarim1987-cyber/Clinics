import type { Metadata } from 'next';
import { FileUp } from 'lucide-react';
import { Chip } from '../../_ui/Ui';
import { OPENING_COLUMNS, OPENING_KINDS } from '@/server/wholesale/import/opening';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { openingImportsQuery } from '@/server/wholesale/queries/books';
import { getStudioTranslator } from '@/studio/messages';
import { PageHeader } from '../../_ui/PageHeader';
import { OpeningForm } from '../../_ui/OpeningForm';

export const metadata: Metadata = { title: 'Opening balances' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });

export default async function OpeningPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const imports = await queryWh(openingImportsQuery);
  const columns = Object.fromEntries(OPENING_KINDS.map((k) => [k, [...OPENING_COLUMNS[k].required, ...OPENING_COLUMNS[k].optional.map((c) => `${c}?`)].join(', ')]));
  return (
    <>
      <PageHeader icon={FileUp} tone="amber" title={t('wh.opening.title')} description={t('wh.opening.description')} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        <section className="rounded-xl border border-line bg-raised p-4">
          <OpeningForm done={imports.map((i) => i.kind)} columns={columns} />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-md font-semibold">{t('wh.opening.history')}</h2>
          {imports.length === 0 ? (
            <p className="text-base text-muted">{t('wh.opening.none')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {imports.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised p-3 text-base">
                  <Chip icon={FileUp} tone="amber" size="size-8" />
                  <span className="flex-1 font-semibold">{t(`wh.opening.k.${i.kind}`)}</span>
                  <span className="text-muted tabular-nums" dir="ltr">
                    {i.date} · {i.rows} · {money(i.totalIqd)} IQD
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
