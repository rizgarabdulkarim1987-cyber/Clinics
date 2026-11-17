import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { listReminders } from '@/server/clinic/actions/reminders';
import { clinicTranslator } from '@/server/clinic/translator';
import { RemindersScreen } from './RemindersScreen';

/** Tomorrow's booked patients, each with a WhatsApp message ready to send. */
export default async function ClinicRemindersPage() {
  const { member } = await requireClScreen('reminders');
  const result = await invokeCl(listReminders, {});
  if (!result.ok) notFound();
  const t = await clinicTranslator();
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.reminders.title')}</h1>
        <p className="text-muted">{t('clinic.app.reminders.intro')}</p>
      </div>
      <RemindersScreen initial={result.data} canEditText={member.role === 'OWNER'} />
    </section>
  );
}
