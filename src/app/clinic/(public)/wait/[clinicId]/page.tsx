import { notFound } from 'next/navigation';
import { loadWaitingRoom } from '@/server/clinic/waiting-room';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { getPrisma } from '@/server/data/prisma';
import { getStudioTranslator } from '@/studio/messages';
import { AutoRefresh } from './AutoRefresh';

export const dynamic = 'force-dynamic';

/** The waiting-room screen: numbers and doctor names only, refreshed every few seconds. No patient is ever shown. */
export default async function ClinicWaitPage({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const view = await loadWaitingRoom(getPrisma(), clinicId);
  if (!view) notFound();
  const t = getStudioTranslator(await requestClinicLocale());
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <AutoRefresh />
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{view.clinicName}</h1>
        <p className="text-muted">{t('clinic.app.wait.title')}</p>
      </div>
      {view.doctors.length === 0 ? (
        <p className="text-xl text-muted">{t('clinic.app.wait.none')}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {view.doctors.map((d) => (
            <li key={d.doctorId} className="flex flex-col gap-3 rounded-md border border-line p-5">
              <h2 className="text-xl font-semibold">{d.name}</h2>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted">{t('clinic.app.wait.serving')}</span>
                <span dir="ltr" className="text-5xl font-semibold tabular-nums">
                  {d.serving ?? '–'}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted">{t('clinic.app.wait.next')}</span>
                <span dir="ltr" className="text-2xl tabular-nums">
                  {d.waiting.length > 0 ? d.waiting.join('  ') : '–'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
