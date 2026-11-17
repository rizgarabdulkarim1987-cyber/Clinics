import { redirect } from 'next/navigation';
import { currentClSession } from '@/server/clinic/auth/cookie';
import { requestSpace } from '@/server/clinic/request-space';
import { spaceHome } from '@/server/clinic/space';
import { clinicTranslator } from '@/server/clinic/translator';
import { ClinicSignInForm } from './SignInForm';

/** The app's own sign-in (a clinic's or a beauty centre's, by its path). A person already signed in goes to the home; a Studio session means nothing here. */
export default async function ClinicSignInPage() {
  if (await currentClSession()) redirect(spaceHome(await requestSpace()));
  const t = await clinicTranslator();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.signIn.title')}</h1>
        <p className="text-muted">{t('clinic.app.signIn.intro')}</p>
      </div>
      <ClinicSignInForm />
    </main>
  );
}
