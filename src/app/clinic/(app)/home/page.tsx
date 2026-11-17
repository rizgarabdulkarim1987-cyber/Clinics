import Link from 'next/link';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { homeSummary } from '@/server/clinic/actions/home';
import { spaceBase } from '@/server/clinic/space';
import { clinicTranslator } from '@/server/clinic/translator';

const money = (n: number) => n.toLocaleString('en');

/** The clinic app's home: the desk and the owner see the day at a glance, each card a link to where it is handled. */
export default async function ClinicHomePage() {
  const { member, session, space } = await requireClScreen('home');
  const t = await clinicTranslator();
  const base = spaceBase(space);
  const summary = member.role === 'OWNER' || member.role === 'RECEPTION' ? await invokeCl(homeSummary, {}) : null;
  const data = summary?.ok ? summary.data : null;
  const cards: { key: string; label: string; value: string; href: string }[] = data
    ? [
        { key: 'waiting', label: t('clinic.app.home.waiting'), value: String(data.queue.waiting), href: `${base}/board` },
        { key: 'withDoctor', label: t('clinic.app.home.withDoctor'), value: String(data.queue.withDoctor), href: `${base}/board` },
        { key: 'toPay', label: t('clinic.app.home.toPay'), value: String(data.queue.toPay), href: `${base}/cashier` },
        { key: 'today', label: t('clinic.app.home.bookingsToday'), value: String(data.bookingsToday), href: `${base}/bookings` },
        { key: 'tomorrow', label: t('clinic.app.home.bookingsTomorrow'), value: String(data.bookingsTomorrow), href: `${base}/bookings` },
        { key: 'unreminded', label: t('clinic.app.home.unreminded'), value: String(data.unreminded), href: `${base}/reminders` },
        ...(data.owner
          ? [
              { key: 'collected', label: t('clinic.app.home.collected'), value: money(data.owner.collectedToday), href: `${base}/reports` },
              { key: 'debt', label: t('clinic.app.home.debt'), value: money(data.owner.debt), href: `${base}/debts` },
              { key: 'noShow', label: t('clinic.app.home.noShow'), value: `${data.owner.noShowPercent}%`, href: `${base}/bookings` },
            ]
          : []),
      ]
    : [];
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.home.welcome', { name: session.name })}</h1>
        <p className="text-muted">{t(`clinic.app.home.intro.${member.role}`)}</p>
      </div>
      {cards.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {cards.map((card) => (
            <li key={card.key}>
              <Link href={card.href} className="flex min-h-24 flex-col justify-between gap-2 rounded-md border border-line p-4">
                <span className="text-sm text-muted">{card.label}</span>
                <span dir="ltr" className="text-2xl font-semibold tabular-nums">
                  {card.value}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
