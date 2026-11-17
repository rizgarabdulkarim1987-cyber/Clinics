import { requireClScreen } from '@/server/clinic/access';
import { clinicTranslator } from '@/server/clinic/translator';

/** The clinic app's home. Later plans put each role's day here (the day's patients, the queue, the till). */
export default async function ClinicHomePage() {
  const { member, session } = await requireClScreen('home');
  const t = await clinicTranslator();
  return (
    <section className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{t('clinic.app.home.welcome', { name: session.name })}</h1>
      <p className="text-muted">{t(`clinic.app.home.intro.${member.role}`)}</p>
    </section>
  );
}
