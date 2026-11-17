'use client';

import { useState, useTransition } from 'react';
import { listReminders, markReminded, saveReminderText } from '@/app/clinic/_actions/reminders';
import { useT } from '@/studio/i18n';

interface Row {
  bookingId: string;
  time: string;
  patientName: string;
  phone: string;
  doctorName: string;
  serviceName: string | null;
  remindedAt: Date | null;
  link: string | null;
}
interface Data {
  day: string;
  template: string | null;
  rows: Row[];
}

const inputClass = 'h-11 rounded-md border border-line bg-bg px-3';

export function RemindersScreen({ initial, canEditText }: { initial: Data; canEditText: boolean }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [data, setData] = useState(initial);
  const [day, setDay] = useState(initial.day);
  const [text, setText] = useState(initial.template ?? '');
  const [saved, setSaved] = useState(false);

  const reload = (next: string) =>
    start(async () => {
      const result = await listReminders({ day: next });
      if (result.ok) setData(result.data);
    });

  const sent = (row: Row) => {
    start(async () => {
      const result = await markReminded({ bookingId: row.bookingId });
      if (result.ok) setData((current) => ({ ...current, rows: current.rows.map((r) => (r.bookingId === row.bookingId ? { ...r, remindedAt: new Date() } : r)) }));
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{t('clinic.app.reminders.day')}</span>
        <input
          type="date"
          dir="ltr"
          className={inputClass}
          value={day}
          disabled={pending}
          onChange={(event) => {
            setDay(event.target.value);
            if (event.target.value) reload(event.target.value);
          }}
        />
      </label>

      {data.rows.length === 0 ? (
        <p className="text-muted">{t('clinic.app.reminders.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {data.rows.map((row) => (
            <li key={row.bookingId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  <span dir="ltr" className="me-2 tabular-nums">
                    {row.time}
                  </span>
                  {row.patientName}
                </span>
                <span className="text-sm text-muted">{row.serviceName ? `${row.doctorName} · ${row.serviceName}` : row.doctorName}</span>
              </span>
              {row.link ? (
                <a
                  className="inline-flex h-11 items-center rounded-md border border-line px-4 font-medium"
                  href={row.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (!row.remindedAt) sent(row);
                  }}
                >
                  {row.remindedAt ? t('clinic.app.reminders.again') : t('clinic.app.reminders.send')}
                </a>
              ) : (
                <span className="text-sm text-muted">{t('clinic.app.reminders.noPhone')}</span>
              )}
              {row.remindedAt ? <span className="w-full text-sm text-muted">{t('clinic.app.reminders.sent')}</span> : null}
            </li>
          ))}
        </ul>
      )}

      {canEditText ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            start(async () => {
              const result = await saveReminderText({ text });
              if (result.ok) {
                setSaved(true);
                reload(day);
              }
            });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">{t('clinic.app.reminders.text')}</span>
            <textarea
              className="min-h-24 rounded-md border border-line bg-bg px-3 py-2"
              maxLength={400}
              value={text}
              placeholder={t('clinic.app.reminders.textHint')}
              onChange={(event) => {
                setText(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <span className="text-sm text-muted">{t('clinic.app.reminders.placeholders')}</span>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className="h-11 rounded-md bg-fg px-4 font-medium text-bg disabled:opacity-60">
              {t('clinic.app.reminders.save')}
            </button>
            {saved ? <span className="text-sm text-muted">{t('clinic.app.reminders.saved')}</span> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
