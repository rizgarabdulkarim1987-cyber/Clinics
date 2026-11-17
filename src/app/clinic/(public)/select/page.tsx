import { redirect } from 'next/navigation';
import { getClAccess } from '@/server/clinic/access';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { getStudioTranslator } from '@/studio/messages';
import { ClinicChooser } from './Chooser';

/** A person who works in several clinics picks the one to open. */
export default async function SelectClinicPage() {
  const { entry } = await getClAccess();
  if (entry.kind === 'signIn') redirect(entry.to);
  if (entry.kind !== 'choose') redirect('/clinic');
  const t = getStudioTranslator(await requestClinicLocale());
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.select.title')}</h1>
        <p className="text-muted">{t('clinic.app.select.intro')}</p>
      </div>
      <ClinicChooser clinics={entry.clinics.map((c) => ({ restaurantId: c.restaurantId, name: c.clinicName, role: c.role }))} />
    </main>
  );
}
