'use client';

import { useState, useTransition } from 'react';
import { createPatient, getPatient, searchPatients, updatePatient } from '@/app/clinic/_actions/patients';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

interface Patient {
  patientId: string;
  name: string;
  phone: string;
  birthYear: number | null;
}
interface Opened extends Patient {
  household: Patient[];
}

const asYear = (text: string): number | undefined => (text.trim() === '' ? undefined : Number(text));

/** Search the file, add a patient in one short form, open one to correct it and see who shares the phone. */
export function PatientsScreen({ initial }: { initial: Patient[] }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [found, setFound] = useState<Patient[]>(initial);
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [year, setYear] = useState('');
  const [referrer, setReferrer] = useState('');

  const search = (text: string) =>
    start(async () => {
      const result = await searchPatients({ query: text });
      if (result.ok) setFound(result.data);
    });

  const open = (patientId: string) =>
    start(async () => {
      const result = await getPatient({ patientId });
      if (result.ok) setOpened(result.data);
    });

  return (
    <div className="flex flex-col gap-8">
      {problem && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {t('clinic.app.patients.failed')}
        </p>
      )}

      <form
        className="flex flex-col gap-4 rounded-md border border-line p-4"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            setProblem(false);
            const result = await createPatient({ name, phone, birthYear: asYear(year), ...(referrer.trim() ? { referredByPhone: referrer } : {}) });
            if (!result.ok) return setProblem(true);
            setName('');
            setPhone('');
            setYear('');
            setReferrer('');
            setQuery('');
            const list = await searchPatients({ query: '' });
            if (list.ok) setFound(list.data);
            open(result.data.patientId);
          });
        }}
      >
        <h2 className="text-lg font-semibold">{t('clinic.app.patients.add.title')}</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label={t('clinic.app.patients.name')}>
            <Input size="lg" required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('clinic.app.patients.referredBy')}>
            <Input size="lg" type="tel" dir="ltr" className="rtl:text-right" value={referrer} onChange={(event) => setReferrer(event.target.value)} />
          </Field>
          <Field label={t('clinic.app.patients.phone')}>
            <Input size="lg" type="tel" dir="ltr" className="rtl:text-right" required value={phone} onChange={(event) => setPhone(event.target.value)} />
          </Field>
          <Field label={t('clinic.app.patients.birthYear')}>
            <Input size="lg" inputMode="numeric" dir="ltr" className="rtl:text-right" value={year} onChange={(event) => setYear(event.target.value)} />
          </Field>
        </div>
        <Button type="submit" variant="primary" size="lg" pending={pending} className="sm:self-start">
          {t('clinic.app.patients.add.submit')}
        </Button>
      </form>

      <div className="flex flex-col gap-3">
        <Field label={t('clinic.app.patients.search')}>
          <Input
            size="lg"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              search(event.target.value);
            }}
          />
        </Field>
        {found.length === 0 ? (
          <p className="text-muted">{t('clinic.app.patients.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {found.map((patient) => (
              <li key={patient.patientId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{patient.name}</p>
                  <p className="truncate text-sm text-muted" dir="ltr">
                    {patient.phone}
                    {patient.birthYear ? ` · ${patient.birthYear}` : ''}
                  </p>
                </div>
                <Button variant="secondary" disabled={pending} onClick={() => open(patient.patientId)}>
                  {t('clinic.app.patients.open')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {opened && (
        <form
          key={opened.patientId}
          className="flex flex-col gap-4 rounded-md border border-line p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            start(async () => {
              setProblem(false);
              const result = await updatePatient({
                patientId: opened.patientId,
                name: String(data.get('name') ?? ''),
                phone: String(data.get('phone') ?? ''),
                birthYear: asYear(String(data.get('birthYear') ?? '')),
              });
              if (!result.ok) return setProblem(true);
              open(opened.patientId);
              search(query);
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('clinic.app.patients.name')}>
              <Input name="name" size="lg" required defaultValue={opened.name} />
            </Field>
            <Field label={t('clinic.app.patients.phone')}>
              <Input name="phone" size="lg" type="tel" dir="ltr" className="rtl:text-right" required defaultValue={opened.phone} />
            </Field>
            <Field label={t('clinic.app.patients.birthYear')}>
              <Input name="birthYear" size="lg" inputMode="numeric" dir="ltr" className="rtl:text-right" defaultValue={opened.birthYear ?? ''} />
            </Field>
          </div>
          <Button type="submit" variant="primary" size="lg" pending={pending} className="sm:self-start">
            {t('clinic.app.patients.save')}
          </Button>
          {opened.household.length > 1 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted">{t('clinic.app.patients.household')}</h3>
              <ul className="flex flex-wrap gap-2">
                {opened.household.map((member) => (
                  <li key={member.patientId}>
                    <Button type="button" variant="secondary" disabled={pending || member.patientId === opened.patientId} onClick={() => open(member.patientId)}>
                      {member.name}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
