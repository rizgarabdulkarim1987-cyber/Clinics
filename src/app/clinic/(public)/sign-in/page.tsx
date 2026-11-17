import { redirect } from 'next/navigation';
import { currentClSession } from '@/server/clinic/auth/cookie';
import { CLINIC_HOME } from '@/server/clinic/public-actions/session';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { getStudioTranslator } from '@/studio/messages';
import { ClinicSignInForm } from './SignInForm';

/** The clinic app's own sign-in. A person already signed in to Clinics goes to the home; a Studio session means nothing here. */
export default async function ClinicSignInPage() {
  if (await currentClSession()) redirect(CLINIC_HOME);
  const t = getStudioTranslator(await requestClinicLocale());
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
