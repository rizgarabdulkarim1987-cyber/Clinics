import { notFound } from 'next/navigation';
import { getPrisma } from '@/server/data/prisma';
import { loadPublicClinic } from '@/server/clinic/public-actions/booking';
import { clinicTranslator } from '@/server/clinic/translator';
import { localDay } from '@/server/clinic/time';
import { BookForm } from './BookForm';

/** The page a patient opens from a link or a QR code. It shows the clinic's doctors and free times and never a patient. */
export default async function ClinicBookPage({ params, searchParams }: { params: Promise<{ clinicId: string }>; searchParams: Promise<{ doctor?: string | string[] }> }) {
  const { clinicId } = await params;
  const { doctor } = await searchParams;
  const view = await loadPublicClinic(getPrisma(), clinicId);
  if (!view) notFound();
  // A link for one doctor opens with them chosen; an id that is not one of this clinic's doctors is ignored.
  const wanted = typeof doctor === 'string' ? doctor : '';
  const initialDoctorId = view.doctors.some((d) => d.doctorId === wanted) ? wanted : '';
  const t = await clinicTranslator();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.book.title', { clinic: view.clinicName })}</h1>
        <p className="text-muted">{t('clinic.app.book.intro')}</p>
      </div>
      <BookForm clinicId={clinicId} initialDoctorId={initialDoctorId} doctors={view.doctors} services={view.services} today={localDay(new Date())} />
    </main>
  );
}
