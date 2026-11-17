'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { savePackage, sellPackage } from '@/app/clinic/_actions/packages';
import { searchPatients } from '@/app/clinic/_actions/patients';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

interface Pack {
  packageId?: string;
  name: string;
  sessions: number;
  price: number;
  active: boolean;
}
interface Patient {
  patientId: string;
  name: string;
  phone: string;
}

const digits = (value: string) => value.replace(/\D/g, '');
const selectClass = 'h-11 rounded-md border border-line bg-bg px-2';

/** One course's row: the owner edits it, and a new course is a row without an id. */
function PackRow({ pack }: { pack: Pack }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState(pack.name);
  const [sessions, setSessions] = useState(String(pack.sessions));
  const [price, setPrice] = useState(String(pack.price));
  const [active, setActive] = useState(pack.active);
  const isNew = pack.packageId === undefined;

  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {t('clinic.app.services.failed')}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t('clinic.app.packages.name')}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t('clinic.app.packages.sessions')}>
          <Input inputMode="numeric" dir="ltr" className="rtl:text-right" value={sessions} onChange={(event) => setSessions(digits(event.target.value))} />
        </Field>
        <Field label={t('clinic.app.packages.price')}>
          <Input inputMode="numeric" dir="ltr" className="rtl:text-right" value={price} onChange={(event) => setPrice(digits(event.target.value))} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-3">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          <span>{t('clinic.app.packages.active')}</span>
        </label>
      </div>
      <Button
        variant="primary"
        pending={pending}
        className="sm:self-start"
        onClick={() =>
          start(async () => {
            setFailed(false);
            const result = await savePackage({ ...(pack.packageId ? { packageId: pack.packageId } : {}), name, sessions: Number(sessions || 0), price: Number(price || 0), active });
            if (!result.ok) return setFailed(true);
            if (isNew) {
              setName('');
              setSessions('5');
              setPrice('0');
              setActive(true);
            }
            router.refresh();
          })
        }
      >
        {isNew ? t('clinic.app.packages.add') : t('clinic.app.packages.save')}
      </Button>
    </li>
  );
}

/** Selling a course: find the patient, pick the course and the doctor. The bill then waits in Payments. */
function SellPanel({ packages, doctors }: { packages: Pack[]; doctors: { doctorId: string; name: string }[] }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [packageId, setPackageId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const sellable = packages.filter((p) => p.active && p.packageId);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <h2 className="text-lg font-semibold">{t('clinic.app.packages.sell.title')}</h2>
      <Field label={t('clinic.app.packages.sell.patient')}>
        <Input
          size="lg"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPatient(null);
            start(async () => {
              const result = await searchPatients({ query: event.target.value });
              if (result.ok) setFound(result.data);
            });
          }}
        />
      </Field>
      {!patient && query.trim() !== '' && (
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
      {patient && <p className="font-medium">{patient.name}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('clinic.app.packages.sell.course')}>
          <select className={selectClass} value={packageId} onChange={(event) => setPackageId(event.target.value)}>
            <option value="" />
            {sellable.map((p) => (
              <option key={p.packageId} value={p.packageId}>
                {p.name} · {p.sessions} · {p.price.toLocaleString('en')}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('clinic.app.packages.sell.doctor')}>
          <select className={selectClass} value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
            <option value="" />
            {doctors.map((d) => (
              <option key={d.doctorId} value={d.doctorId}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          pending={pending}
          disabled={!patient || !packageId || !doctorId}
          onClick={() =>
            start(async () => {
              if (!patient) return;
              const result = await sellPackage({ patientId: patient.patientId, packageId, doctorId });
              setState(result.ok ? 'done' : 'failed');
              if (result.ok) {
                setPatient(null);
                setQuery('');
                setFound([]);
              }
            })
          }
        >
          {t('clinic.app.packages.sell.submit')}
        </Button>
        {state !== 'idle' && (
          <span role="status" className={state === 'done' ? 'text-sm text-muted' : 'text-sm text-danger'}>
            {t(state === 'done' ? 'clinic.app.packages.sell.done' : 'clinic.app.services.failed')}
          </span>
        )}
      </div>
    </div>
  );
}

export function PackagesScreen({ owner, packages, doctors }: { owner: boolean; packages: (Pack & { packageId: string })[]; doctors: { doctorId: string; name: string }[] }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <SellPanel packages={packages} doctors={doctors} />
      {packages.length === 0 && !owner && <p className="text-muted">{t('clinic.app.packages.empty')}</p>}
      {owner && (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {packages.map((p) => (
            <PackRow key={p.packageId} pack={p} />
          ))}
          <PackRow pack={{ name: '', sessions: 5, price: 0, active: true }} />
        </ul>
      )}
    </div>
  );
}
