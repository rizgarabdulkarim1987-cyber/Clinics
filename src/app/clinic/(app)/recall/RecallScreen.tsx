'use client';

import { useState, useTransition } from 'react';
import { listRecall } from '@/app/clinic/_actions/recall';
import { useT } from '@/studio/i18n';

interface Row {
  patientId: string;
  name: string;
  phone: string;
  lastVisitDay: string;
  daysAgo: number;
}

const WINDOWS = [90, 180, 365] as const;
const selectClass = 'h-11 rounded-md border border-line bg-bg px-2';

export function RecallScreen({ initial }: { initial: Row[] }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(initial);
  const [days, setDays] = useState<number>(180);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{t('clinic.app.recall.days')}</span>
        <select
          className={selectClass}
          value={days}
          disabled={pending}
          onChange={(event) => {
            const next = Number(event.target.value);
            setDays(next);
            start(async () => {
              const result = await listRecall({ days: next });
              if (result.ok) setRows(result.data);
            });
          }}
        >
          {WINDOWS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      {rows.length === 0 ? (
        <p className="text-muted">{t('clinic.app.recall.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {rows.map((row) => (
            <li key={row.patientId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{row.name}</span>
                <span className="text-sm text-muted">{t('clinic.app.recall.last', { days: row.daysAgo, day: row.lastVisitDay })}</span>
              </span>
              <a dir="ltr" className="font-medium tabular-nums underline" href={`tel:${row.phone}`}>
                {row.phone}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
