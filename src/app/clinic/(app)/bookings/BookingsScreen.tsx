'use client';

import { useEffect, useState, useTransition } from 'react';
import { addToWaitlist, cancelBooking, createBooking, listDay, listSlots, listWaitlist, markNoShow, removeFromWaitlist, rescheduleBooking } from '@/app/clinic/_actions/bookings';
import { searchPatients } from '@/app/clinic/_actions/patients';
import { localMinutes } from '@/server/clinic/time';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

interface Row {
  bookingId: string;
  doctorName: string;
  patientName: string;
  patientPhone: string;
  serviceName: string | null;
  startsAt: string;
  status: 'BOOKED' | 'CHECKED_IN' | 'DONE' | 'CANCELLED' | 'NO_SHOW';
  source: 'STAFF' | 'PUBLIC';
  depositAmount: number;
}
interface Waiting {
  entryId: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  doctorId: string | null;
}
interface Patient {
  patientId: string;
  name: string;
  phone: string;
}

const time = (iso: string) => {
  const m = localMinutes(new Date(iso));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const selectClass = 'h-12 w-full rounded-md border border-line bg-bg px-3';

/** The reception's booking screen: a day's list, a new booking from free times, moving, cancelling, no-shows, waiting list. */
export function BookingsScreen({
  today,
  initialDay,
  initialWaiting,
  doctors,
  services,
}: {
  today: string;
  initialDay: Row[];
  initialWaiting: Waiting[];
  doctors: { doctorId: string; name: string }[];
  services: { serviceId: string; name: string; durationMin: number }[];
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [day, setDay] = useState(today);
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [rows, setRows] = useState<Row[]>(initialDay);
  const [waiting, setWaiting] = useState<Waiting[]>(initialWaiting);
  const [slots, setSlots] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = () =>
    start(async () => {
      const [list, queue] = await Promise.all([listDay({ day, ...(doctorId ? { doctorId } : {}) }), listWaitlist({ day })]);
      if (list.ok) setRows(list.data);
      if (queue.ok) setWaiting(queue.data);
      if (doctorId) {
        const free = await listSlots({ doctorId, day, ...(serviceId ? { serviceId } : {}) });
        setSlots(free.ok ? free.data : []);
      } else setSlots([]);
    });

  // Reload when the day, the doctor or the service changes. The first render already has the server's list for today.
  useEffect(() => {
    if (day === today && !doctorId && !serviceId) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, doctorId, serviceId]);

  const act = (task: () => Promise<{ ok: boolean }>, after?: (result: never) => void) =>
    start(async () => {
      setFailed(false);
      const result = await task();
      if (!result.ok) return setFailed(true);
      after?.(result as never);
      reload();
    });

  const pickSlot = (slot: string) => {
    if (moving) return act(() => rescheduleBooking({ bookingId: moving, startsAt: slot }), () => setMoving(null));
    if (!patient || !doctorId) return;
    act(() => createBooking({ doctorId, patientId: patient.patientId, ...(serviceId ? { serviceId } : {}), startsAt: slot }), () => setPatient(null));
  };

  return (
    <div className="flex flex-col gap-8">
      {failed && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {t('clinic.app.bookings.failed')}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-surface px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('clinic.app.bookings.day')}>
          <Input size="lg" type="date" dir="ltr" value={day} onChange={(event) => event.target.value && setDay(event.target.value)} />
        </Field>
        <Field label={t('clinic.app.bookings.doctor')}>
          <select className={selectClass} value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
            <option value="">{t('clinic.app.bookings.allDoctors')}</option>
            {doctors.map((d) => (
              <option key={d.doctorId} value={d.doctorId}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('clinic.app.bookings.service')}>
          <select className={selectClass} value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
            <option value="">{t('clinic.app.bookings.noService')}</option>
            {services.map((s) => (
              <option key={s.serviceId} value={s.serviceId}>
                {s.name} · {s.durationMin}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-line p-4">
        <h2 className="text-lg font-semibold">{t('clinic.app.bookings.freeTimes')}</h2>
        {!doctorId ? (
          <p className="text-sm text-muted">{t('clinic.app.bookings.pickDoctor')}</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted">{t('clinic.app.bookings.noTimes')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <li key={slot}>
                <Button variant={moving || patient ? 'primary' : 'secondary'} disabled={pending || (!moving && !patient)} onClick={() => pickSlot(slot)}>
                  <span dir="ltr">{time(slot)}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {moving && <p className="text-sm text-muted">{t('clinic.app.bookings.moveHint')}</p>}

        <h3 className="mt-2 font-semibold">{t('clinic.app.bookings.new')}</h3>
        {patient ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{patient.name}</span>
            <span dir="ltr" className="text-sm text-muted">
              {patient.phone}
            </span>
            <Button variant="secondary" onClick={() => setPatient(null)}>
              {t('clinic.app.doctors.remove')}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => act(() => addToWaitlist({ patientId: patient.patientId, ...(doctorId ? { doctorId } : {}), day }), () => setPatient(null))}>
              {t('clinic.app.waitlist.add')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Field label={t('clinic.app.bookings.patient')}>
              <Input
                size="lg"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  start(async () => {
                    const result = await searchPatients({ query: event.target.value });
                    if (result.ok) setFound(result.data);
                  });
                }}
              />
            </Field>
            {query.trim() !== '' && (
              <ul className="flex flex-wrap gap-2">
                {found.slice(0, 8).map((p) => (
                  <li key={p.patientId}>
                    <Button variant="secondary" onClick={() => setPatient(p)}>
                      {p.name} · <span dir="ltr">{p.phone}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-muted">{t('clinic.app.bookings.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {rows.map((row) => (
              <li key={row.bookingId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-4">
                  <span dir="ltr" className="text-lg font-semibold tabular-nums">
                    {time(row.startsAt)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.patientName}</p>
                    <p className="truncate text-sm text-muted">
                      {[row.doctorName, row.serviceName, t(`clinic.app.bookings.status.${row.status}`), row.source === 'PUBLIC' ? t('clinic.app.bookings.online') : '', row.depositAmount > 0 ? t('clinic.app.bookings.deposit', { amount: row.depositAmount.toLocaleString('en') }) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
                {row.status === 'BOOKED' && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={pending} onClick={() => setMoving(moving === row.bookingId ? null : row.bookingId)}>
                      {t('clinic.app.bookings.move')}
                    </Button>
                    <Button variant="secondary" disabled={pending} onClick={() => act(() => markNoShow({ bookingId: row.bookingId }))}>
                      {t('clinic.app.bookings.noShow')}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        act(
                          () => cancelBooking({ bookingId: row.bookingId }),
                          (result: { data: { waiting: { patientName: string }[] } }) =>
                            setNotice(result.data.waiting.length > 0 ? t('clinic.app.bookings.freed', { names: result.data.waiting.map((w) => w.patientName).join('، ') }) : null),
                        )
                      }
                    >
                      {t('clinic.app.bookings.cancel')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('clinic.app.waitlist.title')}</h2>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted">{t('clinic.app.waitlist.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {waiting.map((w) => (
              <li key={w.entryId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{w.patientName}</p>
                  <p className="text-sm text-muted" dir="ltr">
                    {w.patientPhone}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={pending} onClick={() => setPatient({ patientId: w.patientId, name: w.patientName, phone: w.patientPhone })}>
                    {t('clinic.app.waitlist.book')}
                  </Button>
                  <Button variant="secondary" disabled={pending} onClick={() => act(() => removeFromWaitlist({ entryId: w.entryId }))}>
                    {t('clinic.app.waitlist.remove')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
