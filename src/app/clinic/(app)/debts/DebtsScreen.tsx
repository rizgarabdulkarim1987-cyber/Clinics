'use client';

import { useState, useTransition } from 'react';
import { rescheduleDebt } from '@/app/clinic/_actions/bills';
import { agedDebts } from '@/app/clinic/_actions/reports';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Input } from '@/studio/ui/Input';

type Key = 'NOT_DUE' | 'D1_30' | 'D31_60' | 'D61_PLUS';
interface Debts {
  buckets: { key: Key; count: number; balance: number }[];
  rows: { billId: string; patientName: string; patientPhone: string; balance: number; dueDay: string | null; daysOverdue: number }[];
}

/** One debt: who owes what and since when, with a control to move the due day when the patient pays in parts. */
function DebtRow({ row, onMoved }: { row: Debts['rows'][number]; onMoved: () => void }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [day, setDay] = useState('');
  const [failed, setFailed] = useState(false);
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.patientName}</span>
          <a dir="ltr" className="text-sm text-muted underline" href={`tel:${row.patientPhone}`}>
            {row.patientPhone}
          </a>
        </span>
        <span className="text-end">
          <span className="block text-sm text-muted">{t('clinic.app.debts.balance')}</span>
          <span dir="ltr" className="font-semibold tabular-nums">
            {row.balance.toLocaleString('en')}
          </span>
        </span>
      </div>
      <p className="text-sm text-muted">
        {row.dueDay && t('clinic.app.debts.due', { day: row.dueDay })}
        {row.daysOverdue > 0 && ` · ${t('clinic.app.debts.late', { days: row.daysOverdue })}`}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t('clinic.app.debts.moveTo')}
          <Input type="date" dir="ltr" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        <Button
          variant="secondary"
          pending={pending}
          disabled={!day}
          onClick={() =>
            start(async () => {
              setFailed(false);
              const result = await rescheduleDebt({ billId: row.billId, dueDay: day });
              if (!result.ok) return setFailed(true);
              setDay('');
              onMoved();
            })
          }
        >
          {t('clinic.app.debts.move')}
        </Button>
        {failed && (
          <span role="alert" className="text-sm text-danger">
            {t('clinic.app.services.failed')}
          </span>
        )}
      </div>
    </li>
  );
}

export function DebtsScreen({ initial }: { initial: Debts }) {
  const t = useT();
  const [data, setData] = useState(initial);
  const reload = async () => {
    const result = await agedDebts({});
    if (result.ok) setData(result.data);
  };

  if (data.rows.length === 0) return <p className="text-muted">{t('clinic.app.debts.empty')}</p>;
  return (
    <div className="flex flex-col gap-6">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.buckets.map((b) => (
          <li key={b.key} className="flex flex-col gap-1 rounded-md bg-surface p-3">
            <span className="text-sm text-muted">{t(`clinic.app.debts.bucket.${b.key}`)}</span>
            <span dir="ltr" className="text-xl font-semibold tabular-nums">
              {b.balance.toLocaleString('en')}
            </span>
            <span className="text-sm text-muted tabular-nums">{b.count}</span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
        {data.rows.map((row) => (
          <DebtRow key={row.billId} row={row} onMoved={() => void reload()} />
        ))}
      </ul>
    </div>
  );
}
