'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveService } from '@/app/clinic/_actions/bookings';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { CopyButton } from '@/studio/ui/CopyButton';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

interface Service {
  serviceId?: string;
  name: string;
  durationMin: number;
  depositAmount: number;
  active: boolean;
}

/** One service's row: name, minutes, deposit, whether it is on offer. A new service is a row without an id. */
function ServiceRow({ service }: { service: Service }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState(service.name);
  const [minutes, setMinutes] = useState(String(service.durationMin));
  const [deposit, setDeposit] = useState(String(service.depositAmount));
  const [active, setActive] = useState(service.active);
  const isNew = service.serviceId === undefined;

  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {t('clinic.app.services.failed')}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t('clinic.app.services.name')}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t('clinic.app.services.duration')}>
          <Input inputMode="numeric" dir="ltr" className="rtl:text-right" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
        </Field>
        <Field label={t('clinic.app.services.deposit')}>
          <Input inputMode="numeric" dir="ltr" className="rtl:text-right" value={deposit} onChange={(event) => setDeposit(event.target.value)} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-3">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          <span>{t('clinic.app.services.active')}</span>
        </label>
      </div>
      <Button
        variant="primary"
        pending={pending}
        className="sm:self-start"
        onClick={() =>
          start(async () => {
            setFailed(false);
            const result = await saveService({ ...(service.serviceId ? { serviceId: service.serviceId } : {}), name, durationMin: Number(minutes), depositAmount: Number(deposit), active });
            if (!result.ok) return setFailed(true);
            if (isNew) {
              setName('');
              setMinutes('15');
              setDeposit('0');
              setActive(true);
            }
            router.refresh();
          })
        }
      >
        {isNew ? t('clinic.app.services.add') : t('clinic.app.services.save')}
      </Button>
    </li>
  );
}

export function ServicesScreen({ services, bookingUrl }: { services: (Service & { serviceId: string })[]; bookingUrl: string }) {
  const t = useT();
  const link = bookingUrl;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-md bg-surface p-4">
        <h2 className="font-semibold">{t('clinic.app.services.link')}</h2>
        <p className="text-sm text-muted">{t('clinic.app.services.linkNote')}</p>
        <div className="flex items-center gap-2">
          <code dir="ltr" className="min-w-0 flex-1 truncate text-sm">
            {link}
          </code>
          {link && <CopyButton value={link} />}
        </div>
      </div>
      {services.length === 0 && <p className="text-muted">{t('clinic.app.services.empty')}</p>}
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
        {services.map((service) => (
          <ServiceRow key={service.serviceId} service={service} />
        ))}
        <ServiceRow service={{ name: '', durationMin: 15, depositAmount: 0, active: true }} />
      </ul>
    </div>
  );
}
