import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { listDay, listWaitlist } from '@/server/clinic/actions/bookings';
import { listDoctors } from '@/server/clinic/actions/doctors';
import { listServices } from '@/server/clinic/actions/services';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { localDay } from '@/server/clinic/time';
import { getStudioTranslator } from '@/studio/messages';
import { BookingsScreen } from './BookingsScreen';

/** Bookings: one day's appointments, new bookings from free times, moving, cancelling, no-shows and the waiting list. */
export default async function ClinicBookingsPage() {
  await requireClScreen('bookings');
  const today = localDay(new Date());
  const [day, waiting, doctors, services] = await Promise.all([
    invokeCl(listDay, { day: today }),
    invokeCl(listWaitlist, { day: today }),
    invokeCl(listDoctors, {}),
    invokeCl(listServices, {}),
  ]);
  if (!day.ok || !waiting.ok || !doctors.ok || !services.ok) notFound();
  const t = getStudioTranslator(await requestClinicLocale());
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.bookings.title')}</h1>
        <p className="text-muted">{t('clinic.app.bookings.intro')}</p>
      </div>
      <BookingsScreen
        today={today}
        initialDay={day.data}
        initialWaiting={waiting.data}
        doctors={doctors.data.flatMap((d) => (d.doctorId && d.active ? [{ doctorId: d.doctorId, name: d.name }] : []))}
        services={services.data.filter((s) => s.active).map((s) => ({ serviceId: s.serviceId, name: s.name, durationMin: s.durationMin }))}
      />
    </section>
  );
}
