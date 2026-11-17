'use client';

import { useState, useTransition } from 'react';
import { addBillLine, leaveAsDebt, listBills, removeBillLine, saveRate, takePayment } from '@/app/clinic/_actions/bills';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

type Status = 'OPEN' | 'DEBT' | 'PAID';
interface Line {
  lineId: string;
  label: string;
  amount: number;
}
interface Bill {
  billId: string;
  status: Status;
  number: number;
  patientName: string;
  doctorName: string;
  total: number;
  paid: number;
  balance: number;
  dueDay: string | null;
  lines: Line[];
}

const TABS: Status[] = ['OPEN', 'DEBT', 'PAID'];
const selectClass = 'h-11 rounded-md border border-line bg-bg px-2';
const money = (value: number) => value.toLocaleString('en');

export function CashierScreen({ initial, initialRate, canSetRate }: { initial: Bill[]; initialRate: number; canSetRate: boolean }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<Status>('OPEN');
  const [bills, setBills] = useState<Bill[]>(initial);
  const [rate, setRate] = useState(String(initialRate));
  const [rateSaved, setRateSaved] = useState<boolean | null>(null);

  const reload = async (status: Status) => {
    const result = await listBills({ status });
    if (result.ok) setBills(result.data as Bill[]);
  };

  return (
    <div className="flex flex-col gap-6">
      {canSetRate && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-line p-4">
          <Field label={t('clinic.app.cashier.rate')}>
            <Input
              dir="ltr"
              inputMode="numeric"
              value={rate}
              onChange={(event) => {
                setRate(event.target.value.replace(/\D/g, ''));
                setRateSaved(null);
              }}
            />
          </Field>
          <Button
            variant="secondary"
            pending={pending}
            onClick={() =>
              start(async () => {
                const result = await saveRate({ usdRate: Number(rate) });
                setRateSaved(result.ok);
              })
            }
          >
            {t('clinic.app.cashier.rateSave')}
          </Button>
          {rateSaved !== null && (
            <span role="status" className={rateSaved ? 'text-sm text-muted' : 'text-sm text-danger'}>
              {t(rateSaved ? 'clinic.app.cashier.rateSaved' : 'clinic.app.cashier.failed')}
            </span>
          )}
        </div>
      )}

      <div role="tablist" className="flex gap-2">
        {TABS.map((status) => (
          <Button
            key={status}
            role="tab"
            aria-selected={tab === status}
            variant={tab === status ? 'primary' : 'secondary'}
            onClick={() => {
              setTab(status);
              start(() => reload(status));
            }}
          >
            {t(`clinic.app.cashier.tab.${status}`)}
          </Button>
        ))}
      </div>

      {bills.length === 0 ? (
        <p className="text-muted">{t('clinic.app.cashier.empty')}</p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {bills.map((bill) => (
            <li key={bill.billId}>
              <BillCard bill={bill} rate={Number(rate) || initialRate} onChanged={() => reload(tab)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BillCard({ bill, rate, onChanged }: { bill: Bill; rate: number; onChanged: () => Promise<void> }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const [change, setChange] = useState<number | null>(null);
  const [currency, setCurrency] = useState<'IQD' | 'USD'>('IQD');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [lineAmount, setLineAmount] = useState('');
  const [dueDay, setDueDay] = useState('');
  const open = bill.status === 'OPEN';
  const payable = bill.status !== 'PAID' && bill.balance > 0;

  const run = (task: () => Promise<{ ok: boolean; data?: unknown }>, after?: (data: never) => void) =>
    start(async () => {
      setFailed(false);
      const result = await task();
      if (!result.ok) setFailed(true);
      else after?.(result.data as never);
      await onChanged();
    });

  /** Dollars are typed as dollars and sent as cents; dinars as dinars. */
  const tendered = currency === 'IQD' ? Math.round(Number(amount)) : Math.round(Number(amount) * 100);
  const converted = currency === 'IQD' ? tendered : Math.round((tendered * rate) / 100);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xl font-semibold tabular-nums">{t('clinic.app.cashier.token', { number: bill.number })}</span>
        <span className="truncate text-sm text-muted">{bill.doctorName}</span>
      </div>
      <p className="font-medium">{bill.patientName}</p>

      <ul className="flex flex-col divide-y divide-line">
        {bill.lines.map((line) => (
          <li key={line.lineId} className="flex items-center justify-between gap-2 py-1.5">
            <span className="min-w-0 truncate">{line.label}</span>
            <span className="flex items-center gap-2">
              <span dir="ltr" className="tabular-nums">
                {money(line.amount)}
              </span>
              {open && (
                <Button variant="secondary" disabled={pending} onClick={() => run(() => removeBillLine({ lineId: line.lineId }))}>
                  {t('clinic.app.cashier.remove')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-muted">{t('clinic.app.cashier.total')}</dt>
          <dd dir="ltr" className="font-semibold tabular-nums">
            {money(bill.total)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('clinic.app.cashier.paid')}</dt>
          <dd dir="ltr" className="font-semibold tabular-nums">
            {money(bill.paid)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('clinic.app.cashier.balance')}</dt>
          <dd dir="ltr" className="font-semibold tabular-nums">
            {money(bill.balance)}
          </dd>
        </div>
      </dl>
      {bill.dueDay && <p className="text-sm text-muted">{t('clinic.app.cashier.due', { day: bill.dueDay })}</p>}
      {bill.status === 'PAID' && <p className="text-sm text-muted">{t('clinic.app.cashier.settled')}</p>}

      {failed && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {t('clinic.app.cashier.failed')}
        </p>
      )}
      {change !== null && change > 0 && (
        <p role="status" className="rounded-md bg-surface px-3 py-2 font-semibold">
          {t('clinic.app.cashier.change', { amount: money(change) })}
        </p>
      )}

      {open && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('clinic.app.cashier.lineLabel')}>
            <Input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
          </Field>
          <Field label={t('clinic.app.cashier.lineAmount')}>
            <Input dir="ltr" inputMode="numeric" value={lineAmount} onChange={(event) => setLineAmount(event.target.value.replace(/\D/g, ''))} />
          </Field>
          <Button
            variant="secondary"
            disabled={pending || !label.trim() || !lineAmount}
            onClick={() =>
              run(
                () => addBillLine({ billId: bill.billId, label, amount: Number(lineAmount) }),
                () => {
                  setLabel('');
                  setLineAmount('');
                },
              )
            }
          >
            {t('clinic.app.cashier.addLine')}
          </Button>
        </div>
      )}

      {payable && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('clinic.app.cashier.currency')}>
            <select className={selectClass} value={currency} onChange={(event) => setCurrency(event.target.value as 'IQD' | 'USD')}>
              <option value="IQD">{t('clinic.app.cashier.currency.IQD')}</option>
              <option value="USD">{t('clinic.app.cashier.currency.USD')}</option>
            </select>
          </Field>
          <Field label={t(`clinic.app.cashier.amount${currency}`)}>
            <Input dir="ltr" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(currency === 'IQD' ? /\D/g : /[^\d.]/g, ''))} />
          </Field>
          <Button
            variant="primary"
            disabled={pending || !(tendered > 0)}
            onClick={() =>
              run(
                () => takePayment({ billId: bill.billId, currency, amount: tendered }),
                (data: { changeIqd: number }) => {
                  setChange(data.changeIqd);
                  setAmount('');
                },
              )
            }
          >
            {t('clinic.app.cashier.pay')}
            {converted > 0 && currency === 'USD' ? ` · ${money(converted)}` : ''}
          </Button>
        </div>
      )}

      {open && bill.balance > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('clinic.app.cashier.dueDay')}>
            <Input type="date" dir="ltr" value={dueDay} onChange={(event) => setDueDay(event.target.value)} />
          </Field>
          <Button variant="secondary" disabled={pending || !dueDay} onClick={() => run(() => leaveAsDebt({ billId: bill.billId, dueDay }))}>
            {t('clinic.app.cashier.debt')}
          </Button>
        </div>
      )}
    </div>
  );
}
