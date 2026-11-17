import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { getDistribution } from '@/server/clinic/actions/board';
import { listDoctors } from '@/server/clinic/actions/doctors';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { getStudioTranslator } from '@/studio/messages';
import { DistributionPicker } from './DistributionPicker';
import { DoctorsScreen } from './DoctorsScreen';

/** The doctors: the owner edits, the receptionist reads. The server refuses every edit from any other role, whatever the page shows. */
export default async function ClinicDoctorsPage() {
  const { member } = await requireClScreen('doctors');
  const [result, distribution] = await Promise.all([invokeCl(listDoctors, {}), invokeCl(getDistribution, {})]);
  if (!result.ok) notFound();
  const t = getStudioTranslator(await requestClinicLocale());
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.doctors.title')}</h1>
        <p className="text-muted">{t('clinic.app.doctors.intro')}</p>
      </div>
      {member.role === 'OWNER' && distribution.ok && <DistributionPicker initial={distribution.data.rule} />}
      <DoctorsScreen doctors={result.data} canEdit={member.role === 'OWNER'} />
    </section>
  );
}
