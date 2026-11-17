import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { dayReport, doctorShares } from '@/server/clinic/actions/reports';
import { listShifts } from '@/server/clinic/actions/shifts';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { localDay } from '@/server/clinic/time';
import { getStudioTranslator } from '@/studio/messages';
import { ReportsScreen } from './ReportsScreen';

/** The owner's reports: the day's money, each doctor's share, and the recent till shifts. */
export default async function ClinicReportsPage() {
  await requireClScreen('reports');
  const today = localDay(new Date());
  const [day, shares, shifts] = await Promise.all([invokeCl(dayReport, { day: today }), invokeCl(doctorShares, { fromDay: today, toDay: today }), invokeCl(listShifts, {})]);
  if (!day.ok || !shares.ok || !shifts.ok) notFound();
  const t = getStudioTranslator(await requestClinicLocale());
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.reports.title')}</h1>
        <p className="text-muted">{t('clinic.app.reports.intro')}</p>
      </div>
      <ReportsScreen today={today} initialDay={day.data} initialShares={shares.data} shifts={shifts.data} />
    </section>
  );
}
