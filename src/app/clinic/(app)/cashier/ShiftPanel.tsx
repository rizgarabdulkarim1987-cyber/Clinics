'use client';

import { useState, useTransition } from 'react';
import { closeShift, currentShift, openShift } from '@/app/clinic/_actions/shifts';
import { localMinutes } from '@/server/clinic/time';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

interface Shift {
  shiftId: string;
  openedAt: string;
  openingIqd: number;
  expectedIqd: number;
  expectedUsd: number;
}

const money = (value: number) => value.toLocaleString('en');
/** Dollars are kept as cents; the drawer is counted in dollars. */
const dollars = (cents: number) => (cents / 100).toFixed(2);
const clock = (iso: string) => {
  const m = localMinutes(new Date(iso));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** The till shift: open it with a float, close it with a count of the drawer. */
export function ShiftPanel({ initial }: { initial: Shift | null }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [shift, setShift] = useState<Shift | null>(initial);
  const [failed, setFailed] = useState(false);
  const [float, setFloat] = useState('0');
  const [countedIqd, setCountedIqd] = useState('');
  const [countedUsd, setCountedUsd] = useState('');
  const [difference, setDifference] = useState<{ iqd: number; usd: number } | null>(null);

  const refresh = async () => {
    const result = await currentShift({});
    if (result.ok) setShift(result.data as Shift | null);
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <h2 className="text-lg font-semibold">{t('clinic.app.cashier.shift.title')}</h2>
      {failed && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {t('clinic.app.cashier.failed')}
        </p>
      )}
      {difference && (
        <p role="status" className="rounded-md bg-surface px-3 py-2 font-semibold">
          {t('clinic.app.cashier.shift.difference', { iqd: money(difference.iqd), usd: dollars(difference.usd) })}
        </p>
      )}

      {shift === null ? (
        <div className="flex flex-wrap items-end gap-3">
          <p className="basis-full text-sm text-muted">{t('clinic.app.cashier.shift.none')}</p>
          <Field label={t('clinic.app.cashier.shift.opening')}>
            <Input dir="ltr" inputMode="numeric" value={float} onChange={(event) => setFloat(event.target.value.replace(/\D/g, ''))} />
          </Field>
          <Button
            variant="primary"
            pending={pending}
            onClick={() =>
              start(async () => {
                setFailed(false);
                setDifference(null);
                const result = await openShift({ openingIqd: Number(float || 0) });
                if (!result.ok) setFailed(true);
                await refresh();
              })
            }
          >
            {t('clinic.app.cashier.shift.open')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('clinic.app.cashier.shift.since', { time: clock(shift.openedAt) })}</p>
          <p dir="ltr" className="tabular-nums">
            {t('clinic.app.cashier.shift.expectedIqd', { amount: money(shift.expectedIqd) })}
          </p>
          <p dir="ltr" className="tabular-nums">
            {t('clinic.app.cashier.shift.expectedUsd', { amount: dollars(shift.expectedUsd) })}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('clinic.app.cashier.shift.countedIqd')}>
              <Input dir="ltr" inputMode="numeric" value={countedIqd} onChange={(event) => setCountedIqd(event.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label={t('clinic.app.cashier.shift.countedUsd')}>
              <Input dir="ltr" inputMode="decimal" value={countedUsd} onChange={(event) => setCountedUsd(event.target.value.replace(/[^\d.]/g, ''))} />
            </Field>
            <Button
              variant="primary"
              pending={pending}
              disabled={countedIqd === ''}
              onClick={() =>
                start(async () => {
                  setFailed(false);
                  const result = await closeShift({ countedIqd: Number(countedIqd), countedUsd: Math.round(Number(countedUsd || 0) * 100) });
                  if (result.ok) {
                    const data = result.data as { differenceIqd: number; differenceUsd: number };
                    setDifference({ iqd: data.differenceIqd, usd: data.differenceUsd });
                    setCountedIqd('');
                    setCountedUsd('');
                  } else setFailed(true);
                  await refresh();
                })
              }
            >
              {t('clinic.app.cashier.shift.close')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
