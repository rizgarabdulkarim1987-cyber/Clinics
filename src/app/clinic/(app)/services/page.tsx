import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { listServices } from '@/server/clinic/actions/services';
import { spaceBase } from '@/server/clinic/space';
import { clinicTranslator } from '@/server/clinic/translator';
import { ServicesScreen } from './ServicesScreen';

/** The services a patient can book. The owner's; any other role gets "not found". */
export default async function ClinicServicesPage() {
  const { member, space } = await requireClScreen('services');
  const result = await invokeCl(listServices, {});
  if (!result.ok) notFound();
  const t = await clinicTranslator();
  // The address this page is served from, so the link is right on whichever host the clinic app has.
  const sent = await headers();
  const host = sent.get('x-forwarded-host') ?? sent.get('host') ?? '';
  const origin = `${sent.get('x-forwarded-proto') ?? 'https'}://${host}`;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.services.title')}</h1>
        <p className="text-muted">{t('clinic.app.services.intro')}</p>
      </div>
      <ServicesScreen services={result.data} bookingUrl={`${origin}${spaceBase(space)}/book/${member.restaurantId}`} />
    </section>
  );
}
