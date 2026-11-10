'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { cancelAgencyOrder, collectAgencyOrder, createAgencyOrder, payAgencyCost, receiveAgencyAdvance, settleAgencyOrder } from '@/app/wholesale/_actions/company';
import { D } from '@/server/domain/wholesale/money';
import { planSettlement } from '@/server/domain/wholesale/agency';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui';

/** The forms of an agency order. No motion; every form refreshes the page it sits on when the server accepts it. */

const field = 'h-10 w-full rounded-md border border-line-strong bg-raised px-2.5 text-base';
const num = 'tabular-nums';
const money = (v: string | number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

export type Option = { id: string; label: string };

/** Runs one server action, shows its result, refreshes. */
function useSubmit(done?: (data: unknown) => void) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const submit = (call: () => Promise<unknown>) =>
    start(async () => {
      const result = (await settle(call as never)) as { ok: boolean; error?: never; data?: unknown };
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error as never).message);
        return;
      }
      toast.success(t('wh.agency.saved'));
      if (done) done(result.data);
      else router.refresh();
    });
  return { pending, submit };
}

function Label({ text, children, hint }: { text: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-muted">
      {text}
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}

const CURRENCY_OPTIONS = ['IQD', 'USD', 'IRT'] as const;

export function NewAgencyForm({ principals }: { principals: Option[] }) {
  const t = useT();
  const router = useRouter();
  const [principalId, setPrincipalId] = useState(principals[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [currency, setCurrency] = useState<(typeof CURRENCY_OPTIONS)[number]>('IQD');
  const [agreedTotal, setAgreedTotal] = useState('');
  const { pending, submit } = useSubmit((data) => {
    const id = (data as { orderId?: string } | undefined)?.orderId;
    router.push(id ? `/wholesale/agency/${id}` : '/wholesale/agency');
    router.refresh();
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => createAgencyOrder({ principalId, title, note: note || null, currency, agreedTotal: agreedTotal || '0' }));
      }}
    >
      <Label text={t('wh.agency.principal')}>
        <select value={principalId} onChange={(e) => setPrincipalId(e.target.value)} className={field} required dir="auto">
          {principals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Label>
      <Label text={t('wh.agency.orderTitle')}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} required maxLength={200} dir="auto" />
      </Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label text={t('wh.agency.currency')}>
          <select value={currency} onChange={(e) => setCurrency(e.target.value as (typeof CURRENCY_OPTIONS)[number])} className={field} dir="ltr">
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Label>
        <Label text={t('wh.agency.agreedTotal')}>
          <input value={agreedTotal} onChange={(e) => setAgreedTotal(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0" className={`${field} ${num}`} />
        </Label>
      </div>
      <Label text={t('wh.agency.note')}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className="w-full rounded-md border border-line-strong bg-raised px-2.5 py-2 text-base" dir="auto" />
      </Label>
      <Button type="submit" disabled={pending || !principalId}>
        {t('wh.agency.save')}
      </Button>
    </form>
  );
}

/** Where received money goes: the till, or a rep's custody. */
function IntoPicker({ reps, value, onChange }: { reps: Option[]; value: string; onChange: (v: string) => void }) {
  const t = useT();
  if (reps.length === 0) return null;
  return (
    <Label text={t('wh.agency.advance.into')}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={field} dir="auto">
        <option value="">{t('wh.agency.advance.till')}</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {t('wh.agency.advance.rep')}: {r.label}
          </option>
        ))}
      </select>
    </Label>
  );
}

/** An advance (kind advance) or the payment of the balance (kind collect): an amount, where it goes, a note. */
export function MoneyInForm({ orderId, currency, reps, kind, max }: { orderId: string; currency: string; reps: Option[]; kind: 'advance' | 'collect'; max?: string }) {
  const t = useT();
  const [amount, setAmount] = useState(max ?? '');
  const [into, setInto] = useState('');
  const [note, setNote] = useState('');
  const router = useRouter();
  const { pending, submit } = useSubmit(() => {
    setAmount('');
    setNote('');
    router.refresh();
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const input = { orderId, amount, custodyRepId: into || null, note: note || null };
        submit(() => (kind === 'advance' ? receiveAgencyAdvance(input) : collectAgencyOrder(input)));
      }}
    >
      <Label text={`${kind === 'advance' ? t('wh.agency.advance.amount') : t('wh.agency.owed')} (${currency})`}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" required placeholder="0" className={`${field} ${num}`} />
      </Label>
      <IntoPicker reps={reps} value={into} onChange={setInto} />
      <Label text={t('wh.agency.note')}>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={field} dir="auto" />
      </Label>
      <Button type="submit" disabled={pending || !amount}>
        {kind === 'advance' ? t('wh.agency.advance.add') : t('wh.agency.collect.do')}
      </Button>
    </form>
  );
}

export function CostForm({ orderId, currency }: { orderId: string; currency: string }) {
  const t = useT();
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('GOODS');
  const { pending, submit } = useSubmit(() => {
    setAmount('');
    setNote('');
    router.refresh();
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => payAgencyCost({ orderId, amount, category, note: note || null }));
      }}
    >
      <Label text={t('wh.agency.cost.kind')}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
          {['GOODS', 'SHIPPING', 'CUSTOMS', 'OTHER'].map((c) => (
            <option key={c} value={c}>
              {t(`wh.agency.cat.${c}`)}
            </option>
          ))}
        </select>
      </Label>
      <Label text={`${t('wh.agency.cost.amount')} (${currency})`}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" required placeholder="0" className={`${field} ${num}`} />
      </Label>
      <Label text={t('wh.agency.note')}>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={field} dir="auto" />
      </Label>
      <Button type="submit" disabled={pending || !amount}>
        {t('wh.agency.cost.title')}
      </Button>
    </form>
  );
}

/** Delivery: the final total, with a live preview of the advances, what is owed and the profit or loss before anything is posted. */
export function SettleForm({ orderId, currency, held, costs, agreedTotal }: { orderId: string; currency: string; held: string; costs: string; agreedTotal: string }) {
  const t = useT();
  const [total, setTotal] = useState(Number(agreedTotal) > 0 ? agreedTotal : '');
  const { pending, submit } = useSubmit();
  const plan = useMemo(() => {
    try {
      const c = new D(total || '0');
      if (!c.isFinite() || !c.gt(0)) return null;
      return planSettlement({ advanceHeld: new D(held), costs: new D(costs) }, c);
    } catch {
      return null;
    }
  }, [total, held, costs]);
  const row = (label: string, v: string, strong = false) => (
    <div className={`flex justify-between gap-3 ${strong ? 'font-semibold' : ''}`}>
      <dt className="text-muted">{label}</dt>
      <dd className={num} dir="ltr">
        {money(v)} {currency}
      </dd>
    </div>
  );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => settleAgencyOrder({ orderId, total }));
      }}
    >
      <Label text={`${t('wh.agency.settle.total')} (${currency})`} hint={t('wh.agency.settle.totalHint')}>
        <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" dir="ltr" required placeholder="0" className={`${field} ${num}`} />
      </Label>
      {plan && (
        <dl className="flex flex-col gap-1 rounded-md border border-line bg-hover p-3 text-base">
          <dt className="text-sm font-semibold">{t('wh.agency.settle.preview')}</dt>
          {row(t('wh.agency.settle.applied'), plan.applied.toFixed())}
          {row(t('wh.agency.settle.refund'), plan.refund.toFixed())}
          {row(t('wh.agency.settle.owed'), plan.remaining.toFixed(), true)}
          <div className="my-1 border-t border-line" />
          {row(t('wh.agency.costs'), plan.cost.toFixed())}
          {row(plan.profit.isNegative() ? t('wh.agency.loss') : t('wh.agency.profit'), plan.profit.abs().toFixed(), true)}
        </dl>
      )}
      <Button type="submit" disabled={pending || !plan}>
        {t('wh.agency.settle.do')}
      </Button>
    </form>
  );
}

export function CancelAgencyButton({ orderId }: { orderId: string }) {
  const t = useT();
  const { pending, submit } = useSubmit();
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={pending}
      onClick={() => {
        if (window.confirm(t('wh.agency.cancel.confirm'))) submit(() => cancelAgencyOrder({ orderId }));
      }}
    >
      {t('wh.agency.cancel.do')}
    </Button>
  );
}
