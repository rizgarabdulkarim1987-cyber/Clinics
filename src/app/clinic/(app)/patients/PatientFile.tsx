'use client';

import { useEffect, useState } from 'react';
import { getPatientFile } from '@/app/clinic/_actions/patient-file';
import { useT } from '@/studio/i18n';

interface FileData {
  visits: { billId: string; day: string; doctorName: string; total: number; paid: number; status: 'OPEN' | 'PAID' | 'DEBT' }[];
  upcoming: { bookingId: string; startsAt: string; time: string; doctorName: string }[];
  packages: { name: string; sessionsLeft: number }[];
  debt: number;
  stamps: number;
  noShows: number;
}

const money = (n: number) => n.toLocaleString('en');

/** What the desk sees of one patient: visits with money, what is booked, courses, debt, stamps. Nothing clinical. */
export function PatientFile({ patientId }: { patientId: string }) {
  const t = useT();
  const [state, setState] = useState<{ id: string; data: FileData | null } | null>(null);

  useEffect(() => {
    let live = true;
    void getPatientFile({ patientId }).then((result) => {
      if (live) setState({ id: patientId, data: result.ok ? result.data : null });
    });
    return () => {
      live = false;
    };
  }, [patientId]);

  const data = state?.id === patientId ? state.data : null;
  if (!data) return <p className="text-sm text-muted">{t('clinic.app.file.loading')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-muted">{t('clinic.app.file.title')}</h3>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-sm text-muted">{t('clinic.app.file.debt')}</dt>
          <dd className="font-medium tabular-nums" dir="ltr">
            {money(data.debt)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t('clinic.app.file.stamps')}</dt>
          <dd className="font-medium tabular-nums">{data.stamps}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t('clinic.app.file.noShows')}</dt>
          <dd className="font-medium tabular-nums">{data.noShows}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t('clinic.app.file.courses')}</dt>
          <dd className="font-medium">{data.packages.length === 0 ? '—' : data.packages.map((p) => `${p.name} (${p.sessionsLeft})`).join(', ')}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold">{t('clinic.app.file.upcoming')}</h4>
        {data.upcoming.length === 0 ? (
          <p className="text-sm text-muted">{t('clinic.app.file.noUpcoming')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {data.upcoming.map((b) => (
              <li key={b.bookingId}>
                <span dir="ltr" className="tabular-nums">
                  {b.startsAt.slice(0, 10)} {b.time}
                </span>{' '}
                · {b.doctorName}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold">{t('clinic.app.file.visits')}</h4>
        {data.visits.length === 0 ? (
          <p className="text-sm text-muted">{t('clinic.app.file.noVisits')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line text-sm">
            {data.visits.map((v) => (
              <li key={v.billId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span dir="ltr" className="tabular-nums">
                    {v.day}
                  </span>{' '}
                  · {v.doctorName}
                </span>
                <span dir="ltr" className="tabular-nums">
                  {money(v.paid)} / {money(v.total)} · {t(`clinic.app.file.status.${v.status}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
