'use client';

import { useSyncExternalStore } from 'react';
import { useT } from '@/studio/i18n';

interface Item {
  doctorId: string;
  name: string;
}

/** One public booking link per doctor, to put in a bio or a message; the clinic's own link opens with nobody chosen. */
export function BookingLinks({ clinicId, base, doctors }: { clinicId: string; base: string; doctors: Item[] }) {
  const t = useT();
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => '',
  );
  const own = `${origin}${base}/book/${clinicId}`;
  const rows = [{ key: 'all', label: t('clinic.app.links.all'), url: own }, ...doctors.map((d) => ({ key: d.doctorId, label: d.name, url: `${own}?doctor=${d.doctorId}` }))];
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t('clinic.app.links.title')}</h2>
        <p className="text-sm text-muted">{t('clinic.app.links.intro')}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-1 px-4 py-3">
            <span className="font-medium">{row.label}</span>
            <input readOnly dir="ltr" aria-label={row.label} value={row.url} onFocus={(event) => event.currentTarget.select()} className="h-11 w-full rounded-md border border-line bg-bg px-3 text-sm" />
          </li>
        ))}
      </ul>
    </section>
  );
}
