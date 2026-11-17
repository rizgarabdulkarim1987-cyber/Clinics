import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { getLoyaltySettings } from '@/server/clinic/actions/loyalty';
import { clinicTranslator } from '@/server/clinic/translator';
import { LoyaltyScreen } from './LoyaltyScreen';

/** The owner's loyalty settings: the household stamp card and the referral bonus. */
export default async function ClinicLoyaltyPage() {
  await requireClScreen('loyalty');
  const settings = await invokeCl(getLoyaltySettings, {});
  if (!settings.ok) notFound();
  const t = await clinicTranslator();
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.loyalty.title')}</h1>
        <p className="text-muted">{t('clinic.app.loyalty.intro')}</p>
      </div>
      <LoyaltyScreen initial={settings.data} />
    </section>
  );
}
