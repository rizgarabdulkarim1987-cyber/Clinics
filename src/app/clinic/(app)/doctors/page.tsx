import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { getDistribution } from '@/server/clinic/actions/board';
import { listDoctorLeaves, listDoctors } from '@/server/clinic/actions/doctors';
import { clinicTranslator } from '@/server/clinic/translator';
import { DistributionPicker } from './DistributionPicker';
import { DoctorsScreen } from './DoctorsScreen';
import { LeavePanel } from './LeavePanel';

/** The doctors: the owner edits, the receptionist reads. The server refuses every edit from any other role, whatever the page shows. */
export default async function ClinicDoctorsPage() {
  const { member } = await requireClScreen('doctors');
  const [result, distribution, leaves] = await Promise.all([invokeCl(listDoctors, {}), invokeCl(getDistribution, {}), invokeCl(listDoctorLeaves, {})]);
  if (!result.ok) notFound();
  const t = await clinicTranslator();
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.doctors.title')}</h1>
        <p className="text-muted">{t('clinic.app.doctors.intro')}</p>
      </div>
      {member.role === 'OWNER' && distribution.ok && <DistributionPicker initial={distribution.data.rule} />}
      <DoctorsScreen doctors={result.data} canEdit={member.role === 'OWNER'} />
      {leaves.ok && <LeavePanel initial={leaves.data} people={result.data.map((d) => ({ memberId: d.memberId, name: d.name }))} canEdit={member.role === 'OWNER'} />}
    </section>
  );
}
