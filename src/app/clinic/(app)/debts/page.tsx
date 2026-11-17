import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { agedDebts } from '@/server/clinic/actions/reports';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { getStudioTranslator } from '@/studio/messages';
import { DebtsScreen } from './DebtsScreen';

/** What is still owed, by how late it is. */
export default async function ClinicDebtsPage() {
  await requireClScreen('debts');
  const result = await invokeCl(agedDebts, {});
  if (!result.ok) notFound();
  const t = getStudioTranslator(await requestClinicLocale());
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.debts.title')}</h1>
        <p className="text-muted">{t('clinic.app.debts.intro')}</p>
      </div>
      <DebtsScreen initial={result.data} />
    </section>
  );
}
