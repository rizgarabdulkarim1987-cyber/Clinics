'use client';

import { useState, useTransition } from 'react';
import { addDoctorLeave, listDoctorLeaves, removeDoctorLeave } from '@/app/clinic/_actions/doctors';
import { useT } from '@/studio/i18n';

interface Leave {
  leaveId: string;
  memberId: string;
  doctorName: string;
  fromDay: string;
  toDay: string;
  affected: number;
}
interface Person {
  memberId: string;
  name: string;
}

const fieldClass = 'h-11 rounded-md border border-line bg-bg px-3';

/** Days a person is away. The owner adds and removes; the desk only reads, to know who to move. */
export function LeavePanel({ initial, people, canEdit }: { initial: Leave[]; people: Person[]; canEdit: boolean }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [leaves, setLeaves] = useState(initial);
  const [memberId, setMemberId] = useState(people[0]?.memberId ?? '');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [error, setError] = useState(false);

  const reload = async () => {
    const result = await listDoctorLeaves({});
    if (result.ok) setLeaves(result.data);
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t('clinic.app.leave.title')}</h2>
        <p className="text-sm text-muted">{t('clinic.app.leave.intro')}</p>
      </div>

      {leaves.length === 0 ? (
        <p className="text-muted">{t('clinic.app.leave.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {leaves.map((leave) => (
            <li key={leave.leaveId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{leave.doctorName}</span>
                <span dir="ltr" className="text-sm tabular-nums text-muted">
                  {leave.fromDay === leave.toDay ? leave.fromDay : `${leave.fromDay} → ${leave.toDay}`}
                </span>
                {leave.affected > 0 ? <span className="block text-sm font-medium">{t('clinic.app.leave.affected', { count: leave.affected })}</span> : null}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  className="h-11 rounded-md border border-line px-4 disabled:opacity-60"
                  onClick={() =>
                    start(async () => {
                      const result = await removeDoctorLeave({ leaveId: leave.leaveId });
                      if (result.ok) await reload();
                    })
                  }
                >
                  {t('clinic.app.leave.remove')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && people.length > 0 ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(false);
            start(async () => {
              const result = await addDoctorLeave({ memberId, fromDay, toDay: toDay || fromDay });
              if (!result.ok) return setError(true);
              setFromDay('');
              setToDay('');
              await reload();
            });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">{t('clinic.app.leave.who')}</span>
            <select className={fieldClass} value={memberId} onChange={(event) => setMemberId(event.target.value)}>
              {people.map((p) => (
                <option key={p.memberId} value={p.memberId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">{t('clinic.app.leave.from')}</span>
            <input type="date" dir="ltr" required className={fieldClass} value={fromDay} onChange={(event) => setFromDay(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">{t('clinic.app.leave.to')}</span>
            <input type="date" dir="ltr" className={fieldClass} value={toDay} min={fromDay} onChange={(event) => setToDay(event.target.value)} />
          </label>
          <button type="submit" disabled={pending || !fromDay} className="h-11 rounded-md bg-fg px-4 font-medium text-bg disabled:opacity-60">
            {t('clinic.app.leave.add')}
          </button>
          {error ? <span role="alert" className="w-full text-sm">{t('clinic.app.leave.error')}</span> : null}
        </form>
      ) : null}
    </section>
  );
}
