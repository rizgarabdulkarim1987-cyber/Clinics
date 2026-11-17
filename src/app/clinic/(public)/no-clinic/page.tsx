import { clinicTranslator } from '@/server/clinic/translator';
import { requestSpace } from '@/server/clinic/request-space';
import { spaceBase } from '@/server/clinic/space';
import { SignOutButton } from '../../SignOutButton';

/** A signed-in account that works in no clinic: a notice, never a redirect back to sign-in (which would loop). */
export default async function NoClinicPage() {
  const [t, space] = await Promise.all([clinicTranslator(), requestSpace()]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.noClinic.title')}</h1>
        <p className="text-muted">{t('clinic.app.noClinic.body')}</p>
      </div>
      <SignOutButton fallback={`${spaceBase(space)}/sign-in`} />
    </main>
  );
}
