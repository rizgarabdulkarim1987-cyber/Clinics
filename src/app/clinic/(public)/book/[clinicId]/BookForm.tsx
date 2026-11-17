'use client';

import { useEffect, useState, useTransition } from 'react';
import { clinicPublicBook, clinicPublicSlots } from '@/app/clinic/_actions/public-booking';
import { localMinutes } from '@/server/clinic/time';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

const clock = (iso: string) => {
  const m = localMinutes(new Date(iso));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const selectClass = 'h-12 w-full rounded-md border border-line bg-bg px-3';

/** Doctor, visit, day, a free time, then name and phone. A slot taken meanwhile is refused and the times are shown again. */
export function BookForm({
  clinicId,
  doctors,
  services,
  today,
}: {
  clinicId: string;
  doctors: { doctorId: string; name: string; speciality: string }[];
  services: { serviceId: string; name: string; durationMin: number }[];
  today: string;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [day, setDay] = useState(today);
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<{ time: string; day: string } | null>(null);

  const loadSlots = () =>
    start(async () => {
      if (!doctorId) return setSlots([]);
      const result = await clinicPublicSlots({ clinicId, doctorId, day, ...(serviceId ? { serviceId } : {}) });
      setSlots(result.ok ? result.data : []);
    });

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, serviceId, day]);

  if (done) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md border border-line p-4">
        <h2 className="text-lg font-semibold">{t('clinic.app.book.done')}</h2>
        <p>{t('clinic.app.book.doneBody', { time: done.time, day: done.day })}</p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!slot) return;
        start(async () => {
          setFailed(false);
          const result = await clinicPublicBook({ clinicId, doctorId, startsAt: slot, name, phone, ...(serviceId ? { serviceId } : {}) });
          if (result.ok) return setDone({ time: clock(slot), day });
          setFailed(true);
          setSlot(null);
          const again = await clinicPublicSlots({ clinicId, doctorId, day, ...(serviceId ? { serviceId } : {}) });
          setSlots(again.ok ? again.data : []);
        });
      }}
    >
      {failed && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {t('clinic.app.book.failed')}
        </p>
      )}
      <Field label={t('clinic.app.book.doctor')}>
        <select className={selectClass} value={doctorId} onChange={(event) => { setDoctorId(event.target.value); setSlot(null); }} required>
          <option value="" />
          {doctors.map((d) => (
            <option key={d.doctorId} value={d.doctorId}>
              {d.speciality ? `${d.name} · ${d.speciality}` : d.name}
            </option>
          ))}
        </select>
      </Field>
      {services.length > 0 && (
        <Field label={t('clinic.app.book.service')}>
          <select className={selectClass} value={serviceId} onChange={(event) => { setServiceId(event.target.value); setSlot(null); }}>
            <option value="" />
            {services.map((s) => (
              <option key={s.serviceId} value={s.serviceId}>
                {s.name} · {s.durationMin}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t('clinic.app.book.day')}>
        <Input size="lg" type="date" dir="ltr" min={today} value={day} onChange={(event) => { if (event.target.value) { setDay(event.target.value); setSlot(null); } }} />
      </Field>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">{t('clinic.app.book.time')}</h2>
        {!doctorId ? (
          <p className="text-sm text-muted">{t('clinic.app.book.pickDoctor')}</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted">{t('clinic.app.book.noTimes')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {slots.map((s) => (
              <li key={s}>
                <Button type="button" variant={s === slot ? 'primary' : 'secondary'} aria-pressed={s === slot} onClick={() => setSlot(s)}>
                  <span dir="ltr">{clock(s)}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('clinic.app.book.name')}>
          <Input size="lg" required value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t('clinic.app.book.phone')}>
          <Input size="lg" type="tel" dir="ltr" className="rtl:text-right" required value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
      </div>
      <Button type="submit" variant="primary" size="lg" pending={pending} disabled={!slot} className="sm:self-start">
        {pending ? t('clinic.app.book.pending') : t('clinic.app.book.submit')}
      </Button>
    </form>
  );
}
