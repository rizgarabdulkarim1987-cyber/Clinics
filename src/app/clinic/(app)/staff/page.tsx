import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { listStaff } from '@/server/clinic/actions/staff';
import { clinicTranslator } from '@/server/clinic/translator';
import { StaffScreen } from './StaffScreen';

/** The owner's staff screen. The role check is the server's: any other role gets "not found", with or without the link. */
export default async function ClinicStaffPage() {
  await requireClScreen('staff');
  const result = await invokeCl(listStaff, {});
  if (!result.ok) notFound();
  const t = await clinicTranslator();
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.staff.title')}</h1>
        <p className="text-muted">{t('clinic.app.staff.intro')}</p>
      </div>
      <StaffScreen
        members={result.data.members}
        invitations={result.data.invitations.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))}
      />
    </section>
  );
}
