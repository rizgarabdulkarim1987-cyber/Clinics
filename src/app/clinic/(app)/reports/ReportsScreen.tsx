'use client';

import { useState, useTransition } from 'react';
import { dayReport, doctorShares } from '@/app/clinic/_actions/reports';
import { localMinutes } from '@/server/clinic/time';
import { useT } from '@/studio/i18n';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

interface DayData {
  day: string;
  visits: number;
  billed: number;
  appliedIqd: number;
  receivedIqd: number;
  receivedUsdCents: number;
  changeIqd: number;
  debtCount: number;
  debtBalance: number;
  unshiftedPayments: number;
}
interface Share {
  doctorId: string;
  name: string;
  visits: number;
  billed: number;
  collected: number;
  doctorShare: number;
  clinicShare: number;
}
interface Shift {
  shiftId: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  expectedIqd: number | null;
  countedIqd: number | null;
}

const money = (value: number) => value.toLocaleString('en');
const dollars = (cents: number) => (cents / 100).toFixed(2);
const stamp = (iso: string) => {
  const m = localMinutes(new Date(iso));
  return `${iso.slice(0, 10)} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export function ReportsScreen({ today, initialDay, initialShares, shifts }: { today: string; initialDay: DayData; initialShares: Share[]; shifts: Shift[] }) {
  const t = useT();
  const [, start] = useTransition();
  const [day, setDay] = useState(today);
  const [data, setData] = useState<DayData>(initialDay);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [shares, setShares] = useState<Share[]>(initialShares);
  const [failed, setFailed] = useState(false);

  const loadDay = (next: string) =>
    start(async () => {
      setFailed(false);
      const result = await dayReport({ day: next });
      if (result.ok) setData(result.data as DayData);
      else setFailed(true);
    });
  const loadShares = (nextFrom: string, nextTo: string) =>
    start(async () => {
      setFailed(false);
      const result = await doctorShares({ fromDay: nextFrom, toDay: nextTo });
      if (result.ok) setShares(result.data as Share[]);
      else setFailed(true);
    });

  const figures: [string, string][] = [
    [t('clinic.app.reports.visits'), money(data.visits)],
    [t('clinic.app.reports.billed'), money(data.billed)],
    [t('clinic.app.reports.applied'), money(data.appliedIqd)],
    [t('clinic.app.reports.receivedIqd'), money(data.receivedIqd)],
    [t('clinic.app.reports.receivedUsd'), dollars(data.receivedUsdCents)],
    [t('clinic.app.reports.change'), money(data.changeIqd)],
    [t('clinic.app.reports.debts'), `${data.debtCount} · ${money(data.debtBalance)}`],
    [t('clinic.app.reports.unshifted'), money(data.unshiftedPayments)],
  ];

  return (
    <div className="flex flex-col gap-8">
      {failed && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {t('clinic.app.reports.failed')}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <Field label={t('clinic.app.reports.day')}>
          <Input
            type="date"
            dir="ltr"
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
              if (event.target.value) loadDay(event.target.value);
            }}
          />
        </Field>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {figures.map(([label, value]) => (
            <div key={label} className="rounded-md border border-line p-3">
              <dt className="text-sm text-muted">{label}</dt>
              <dd dir="ltr" className="text-lg font-semibold tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('clinic.app.reports.shares.title')}</h2>
        <div className="flex flex-wrap gap-3">
          <Field label={t('clinic.app.reports.from')}>
            <Input
              type="date"
              dir="ltr"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                if (event.target.value && to) loadShares(event.target.value, to);
              }}
            />
          </Field>
          <Field label={t('clinic.app.reports.to')}>
            <Input
              type="date"
              dir="ltr"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                if (from && event.target.value) loadShares(from, event.target.value);
              }}
            />
          </Field>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-start">
            <thead>
              <tr className="text-sm text-muted">
                <th className="py-2 text-start font-medium">{t('clinic.app.reports.doctor')}</th>
                <th className="py-2 text-start font-medium">{t('clinic.app.reports.visits')}</th>
                <th className="py-2 text-start font-medium">{t('clinic.app.reports.billed')}</th>
                <th className="py-2 text-start font-medium">{t('clinic.app.reports.applied')}</th>
                <th className="py-2 text-start font-medium">{t('clinic.app.reports.doctorShare')}</th>
                <th className="py-2 text-start font-medium">{t('clinic.app.reports.clinicShare')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shares.map((row) => (
                <tr key={row.doctorId}>
                  <td className="py-2 pe-4">{row.name}</td>
                  <td dir="ltr" className="py-2 pe-4 tabular-nums">
                    {money(row.visits)}
                  </td>
                  <td dir="ltr" className="py-2 pe-4 tabular-nums">
                    {money(row.billed)}
                  </td>
                  <td dir="ltr" className="py-2 pe-4 tabular-nums">
                    {money(row.collected)}
                  </td>
                  <td dir="ltr" className="py-2 pe-4 font-semibold tabular-nums">
                    {money(row.doctorShare)}
                  </td>
                  <td dir="ltr" className="py-2 tabular-nums">
                    {money(row.clinicShare)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('clinic.app.reports.shifts.title')}</h2>
        <ul className="flex flex-col divide-y divide-line">
          {shifts.map((shift) => (
            <li key={shift.shiftId} dir="ltr" className="py-2 tabular-nums">
              {shift.status === 'OPEN'
                ? `${stamp(shift.openedAt)} · ${t('clinic.app.reports.shifts.open')}`
                : t('clinic.app.reports.shifts.row', { opened: stamp(shift.openedAt), expected: money(shift.expectedIqd ?? 0), counted: money(shift.countedIqd ?? 0) })}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
