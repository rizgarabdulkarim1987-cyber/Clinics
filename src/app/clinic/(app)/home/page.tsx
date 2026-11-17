import { requireClScreen } from '@/server/clinic/access';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { getStudioTranslator } from '@/studio/messages';

/** The clinic app's home. Later plans put each role's day here (the day's patients, the queue, the till). */
export default async function ClinicHomePage() {
  const { member, session } = await requireClScreen('home');
  const t = getStudioTranslator(await requestClinicLocale());
  return (
    <section className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{t('clinic.app.home.welcome', { name: session.name })}</h1>
      <p className="text-muted">{t(`clinic.app.home.intro.${member.role}`)}</p>
    </section>
  );
}
