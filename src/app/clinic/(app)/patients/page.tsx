import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { searchPatients } from '@/server/clinic/actions/patients';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { getStudioTranslator } from '@/studio/messages';
import { PatientsScreen } from './PatientsScreen';

/** The patient file: search, add, open one with its household. The owner and the receptionist; any other role gets "not found". */
export default async function ClinicPatientsPage() {
  await requireClScreen('patients');
  const result = await invokeCl(searchPatients, { query: '' });
  if (!result.ok) notFound();
  const t = getStudioTranslator(await requestClinicLocale());
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.patients.title')}</h1>
        <p className="text-muted">{t('clinic.app.patients.intro')}</p>
      </div>
      <PatientsScreen initial={result.data} />
    </section>
  );
}
