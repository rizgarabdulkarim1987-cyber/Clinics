import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { listRecall } from '@/server/clinic/actions/recall';
import { clinicTranslator } from '@/server/clinic/translator';
import { RecallScreen } from './RecallScreen';

/** Patients not seen for a while, for the desk to phone. */
export default async function ClinicRecallPage() {
  await requireClScreen('recall');
  const result = await invokeCl(listRecall, {});
  if (!result.ok) notFound();
  const t = await clinicTranslator();
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.recall.title')}</h1>
        <p className="text-muted">{t('clinic.app.recall.intro')}</p>
      </div>
      <RecallScreen initial={result.data} />
    </section>
  );
}
