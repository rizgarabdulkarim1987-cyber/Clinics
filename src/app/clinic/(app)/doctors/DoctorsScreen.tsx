'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveDoctorFees, saveDoctorHours, saveDoctorProfile, saveDoctorShare } from '@/app/clinic/_actions/doctors';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

interface Block {
  weekday: number;
  startMin: number;
  endMin: number;
}
interface Fee {
  label: string;
  amount: number;
}
interface Doctor {
  memberId: string;
  name: string;
  speciality: string;
  active: boolean;
  hours: Block[];
  fees: Fee[];
  /** Only the owner's list carries how the doctor is paid. */
  shareMode?: 'PERCENT' | 'FIXED' | 'RENT';
  shareValue?: number;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const toMinutes = (time: string) => {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
};

/** One doctor's card: profile, working week, fee list. Read-only for anyone but the owner. */
function DoctorCard({ doctor, canEdit }: { doctor: Doctor; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<'saved' | 'failed' | null>(null);
  const [speciality, setSpeciality] = useState(doctor.speciality);
  const [active, setActive] = useState(doctor.active);
  const [shareMode, setShareMode] = useState<'PERCENT' | 'FIXED' | 'RENT'>(doctor.shareMode ?? 'PERCENT');
  const [shareValue, setShareValue] = useState(String(doctor.shareValue ?? 0));
  const [blocks, setBlocks] = useState<Block[]>(doctor.hours);
  const [fees, setFees] = useState<{ label: string; amount: string }[]>(doctor.fees.map((f) => ({ label: f.label, amount: String(f.amount) })));

  const save = (task: () => Promise<{ ok: boolean }>) =>
    start(async () => {
      setNote(null);
      const result = await task();
      setNote(result.ok ? 'saved' : 'failed');
      if (result.ok) router.refresh();
    });

  const setBlock = (index: number, patch: Partial<Block>) => setBlocks((all) => all.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const setFee = (index: number, patch: Partial<{ label: string; amount: string }>) => setFees((all) => all.map((f, i) => (i === index ? { ...f, ...patch } : f)));

  return (
    <article className="flex flex-col gap-6 rounded-md border border-line p-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{doctor.name}</h2>
        {!canEdit && <p className="text-sm text-muted">{[doctor.speciality, doctor.active ? '' : t('clinic.app.staff.off')].filter(Boolean).join(' · ')}</p>}
      </header>

      {note && (
        <p role={note === 'failed' ? 'alert' : 'status'} className={note === 'failed' ? 'text-sm text-danger' : 'text-sm text-muted'}>
          {t(note === 'saved' ? 'clinic.app.doctors.saved' : 'clinic.app.doctors.failed')}
        </p>
      )}

      {canEdit && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('clinic.app.doctors.speciality')}>
              <Input size="lg" value={speciality} onChange={(event) => setSpeciality(event.target.value)} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-3">
              <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
              <span>{t('clinic.app.doctors.active')}</span>
            </label>
          </div>
          <Button variant="primary" pending={pending} className="sm:self-start" onClick={() => save(() => saveDoctorProfile({ memberId: doctor.memberId, speciality, active }))}>
            {t('clinic.app.doctors.saveProfile')}
          </Button>
        </div>
      )}

      {canEdit && doctor.shareMode !== undefined && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">{t('clinic.app.doctors.share.title')}</h3>
          <div className="flex flex-wrap items-end gap-3">
            <select aria-label={t('clinic.app.doctors.share.title')} className="h-11 rounded-md border border-line bg-bg px-2" value={shareMode} onChange={(event) => setShareMode(event.target.value as 'PERCENT' | 'FIXED' | 'RENT')}>
              {(['PERCENT', 'FIXED', 'RENT'] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {t(`clinic.app.doctors.share.${mode}`)}
                </option>
              ))}
            </select>
            <Field label={t(`clinic.app.doctors.share.value.${shareMode}`)}>
              <Input inputMode="numeric" dir="ltr" className="rtl:text-right" value={shareValue} onChange={(event) => setShareValue(event.target.value.replace(/\D/g, ''))} />
            </Field>
            <Button variant="primary" pending={pending} onClick={() => save(() => saveDoctorShare({ memberId: doctor.memberId, mode: shareMode, value: Number(shareValue || 0) }))}>
              {t('clinic.app.doctors.share.save')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">{t('clinic.app.doctors.hours.title')}</h3>
        {blocks.length === 0 && <p className="text-sm text-muted">{t('clinic.app.doctors.hours.none')}</p>}
        <ul className="flex flex-col gap-2">
          {blocks.map((b, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <>
                  <select
                    aria-label={t('clinic.app.doctors.hours.title')}
                    className="h-11 rounded-md border border-line bg-bg px-2"
                    value={b.weekday}
                    onChange={(event) => setBlock(index, { weekday: Number(event.target.value) })}
                  >
                    {WEEKDAYS.map((day) => (
                      <option key={day} value={day}>
                        {t(`clinic.app.weekday.${day}`)}
                      </option>
                    ))}
                  </select>
                  <input aria-label={t('clinic.app.doctors.hours.from')} type="time" dir="ltr" className="h-11 rounded-md border border-line bg-bg px-2" value={toTime(b.startMin)} onChange={(event) => setBlock(index, { startMin: toMinutes(event.target.value) })} />
                  <input aria-label={t('clinic.app.doctors.hours.to')} type="time" dir="ltr" className="h-11 rounded-md border border-line bg-bg px-2" value={toTime(b.endMin)} onChange={(event) => setBlock(index, { endMin: toMinutes(event.target.value) })} />
                  <Button variant="secondary" onClick={() => setBlocks((all) => all.filter((_, i) => i !== index))}>
                    {t('clinic.app.doctors.remove')}
                  </Button>
                </>
              ) : (
                <span>
                  {t(`clinic.app.weekday.${b.weekday}`)} <span dir="ltr">{toTime(b.startMin)}–{toTime(b.endMin)}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setBlocks((all) => [...all, { weekday: 0, startMin: 540, endMin: 780 }])}>
              {t('clinic.app.doctors.hours.add')}
            </Button>
            <Button variant="primary" pending={pending} onClick={() => save(() => saveDoctorHours({ memberId: doctor.memberId, blocks }))}>
              {t('clinic.app.doctors.hours.save')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">{t('clinic.app.doctors.fees.title')}</h3>
        {fees.length === 0 && <p className="text-sm text-muted">{t('clinic.app.doctors.fees.none')}</p>}
        <ul className="flex flex-col gap-2">
          {fees.map((f, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <>
                  <Input aria-label={t('clinic.app.doctors.fees.label')} value={f.label} onChange={(event) => setFee(index, { label: event.target.value })} />
                  <Input aria-label={t('clinic.app.doctors.fees.amount')} inputMode="numeric" dir="ltr" className="rtl:text-right" value={f.amount} onChange={(event) => setFee(index, { amount: event.target.value })} />
                  <Button variant="secondary" onClick={() => setFees((all) => all.filter((_, i) => i !== index))}>
                    {t('clinic.app.doctors.remove')}
                  </Button>
                </>
              ) : (
                <span>
                  {f.label} · <span dir="ltr">{Number(f.amount).toLocaleString('en')}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setFees((all) => [...all, { label: '', amount: '0' }])}>
              {t('clinic.app.doctors.fees.add')}
            </Button>
            <Button variant="primary" pending={pending} onClick={() => save(() => saveDoctorFees({ memberId: doctor.memberId, fees: fees.map((f) => ({ label: f.label, amount: Number(f.amount) })) }))}>
              {t('clinic.app.doctors.fees.save')}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

export function DoctorsScreen({ doctors, canEdit }: { doctors: Doctor[]; canEdit: boolean }) {
  const t = useT();
  if (doctors.length === 0) return <p className="text-muted">{t('clinic.app.doctors.empty')}</p>;
  return (
    <div className="flex flex-col gap-6">
      {doctors.map((doctor) => (
        <DoctorCard key={doctor.memberId} doctor={doctor} canEdit={canEdit} />
      ))}
    </div>
  );
}
