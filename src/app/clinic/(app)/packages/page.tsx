import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { listDoctors } from '@/server/clinic/actions/doctors';
import { listPackages } from '@/server/clinic/actions/packages';
import { clinicTranslator } from '@/server/clinic/translator';
import { PackagesScreen } from './PackagesScreen';

/** Courses: the owner defines them, the desk sells them. */
export default async function ClinicPackagesPage() {
  const { member } = await requireClScreen('packages');
  const [packages, doctors] = await Promise.all([invokeCl(listPackages, {}), invokeCl(listDoctors, {})]);
  if (!packages.ok) notFound();
  const t = await clinicTranslator();
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.packages.title')}</h1>
        <p className="text-muted">{t('clinic.app.packages.intro')}</p>
      </div>
      <PackagesScreen
        owner={member.role === 'OWNER'}
        packages={packages.data}
        doctors={doctors.ok ? doctors.data.flatMap((d) => (d.doctorId && d.active ? [{ doctorId: d.doctorId, name: d.name }] : [])) : []}
      />
    </section>
  );
}
