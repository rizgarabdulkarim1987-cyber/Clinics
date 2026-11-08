'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { approveExpense, confirmHandover, convertCash, postExpense, rejectExpense, rejectHandover, submitHandover } from '@/app/wholesale/_actions/company';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { useActionForm, requireFields } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, Field, FormError, Input, Select } from '@/studio/ui';

const CURRENCIES = ['IQD', 'USD', 'IRT'] as const;
const CATEGORIES = ['RENT', 'SALARIES', 'FUEL', 'TRANSPORT', 'UTILITIES', 'OTHER'] as const;

function useCurrencyOptions() {
  const t = useT();
  return CURRENCIES.map((c) => ({ value: c, label: t(`wh.currency.${c}`) }));
}

/** Move cash from one currency box to another at the day's rates. */
export function ConvertForm({ today }: { today: string }) {
  const t = useT();
  const router = useRouter();
  const currencies = useCurrencyOptions();
  const form = useActionForm((v) => settle(() => convertCash({ amount: v.amount ?? '', from: v.from ?? 'USD', to: v.to ?? 'IQD', date: v.date ?? '' })), {
    validate: (v) => requireFields(v, { amount: t('wh.collect.amount') }),
    onSuccess: () => {
      toast.success(t('wh.treasury.converted'));
      router.refresh();
    },
  });
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['amount', 'from', 'to', 'date']} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label={t('wh.collect.amount')} error={form.fieldError('amount')}>
          <Input name="amount" inputMode="decimal" dir="ltr" />
        </Field>
        <Field label={t('wh.treasury.from')}>
          <Select name="from" defaultValue="USD" options={currencies} />
        </Field>
        <Field label={t('wh.treasury.to')}>
          <Select name="to" defaultValue="IQD" options={currencies} />
        </Field>
        <Field label={t('wh.purchases.date')}>
          <Input name="date" type="date" defaultValue={today} dir="ltr" />
        </Field>
      </div>
      <p className="text-sm text-muted">{t('wh.treasury.convertHint')}</p>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.treasury.convert')}
        </Button>
      </div>
    </form>
  );
}

/** A rep hands over what he holds: one amount per currency he has available. */
export function HandoverForm({ available }: { available: { currency: string; available: string }[] }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    (v) => {
      const amounts = available.filter((a) => Number(v[`h_${a.currency}`] || 0) > 0).map((a) => ({ amount: v[`h_${a.currency}`] ?? '', currency: a.currency }));
      return settle(() => submitHandover({ amounts }));
    },
    {
      validate: (v) => (available.some((a) => Number(v[`h_${a.currency}`] || 0) > 0) ? null : { [`h_${available[0]?.currency ?? 'IQD'}`]: t('wh.collect.amount') }),
      onSuccess: () => {
        toast.success(t('wh.handover.sent'));
        router.refresh();
      },
    },
  );
  if (available.length === 0) return <p className="text-base text-muted">{t('wh.handover.nothing')}</p>;
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={available.map((a) => `h_${a.currency}`)} />
      <div className="grid gap-4 sm:grid-cols-3">
        {available.map((a) => (
          <Field key={a.currency} label={`${t(`wh.currency.${a.currency}`)} · ${t('wh.handover.available')} ${Number(a.available).toLocaleString('en-US')}`} error={form.fieldError(`h_${a.currency}`)}>
            <Input name={`h_${a.currency}`} inputMode="decimal" dir="ltr" defaultValue={a.available} />
          </Field>
        ))}
      </div>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.handover.submit')}
        </Button>
      </div>
    </form>
  );
}

/** A partner confirms what really arrived (prefilled with what the rep said) or rejects the handover. */
export function ConfirmHandover({ handoverId, lines }: { handoverId: string; lines: { currency: string; submitted: string }[] }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [received, setReceived] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.currency, l.submitted])));
  const [reason, setReason] = useState('');
  const run = (call: () => Promise<ActionResult<unknown>>, done: string) =>
    start(async () => {
      const result = await settle(call);
      if (result.ok) {
        toast.success(done);
        router.refresh();
      } else toast.error(describeFailure(t, locale, result.error).message);
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {lines.map((l) => (
          <Field key={l.currency} label={`${t(`wh.currency.${l.currency}`)} · ${t('wh.handover.said')} ${Number(l.submitted).toLocaleString('en-US')}`}>
            <Input value={received[l.currency] ?? ''} onChange={(e) => setReceived((r) => ({ ...r, [l.currency]: e.target.value }))} inputMode="decimal" dir="ltr" />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Button type="button" variant="primary" pending={pending} onClick={() => run(() => confirmHandover({ handoverId, received: lines.map((l) => ({ amount: received[l.currency] || '0', currency: l.currency })) }), t('wh.handover.confirmed'))}>
          {t('wh.handover.confirm')}
        </Button>
        <Field label={t('wh.purchases.reason')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
        </Field>
        <Button type="button" variant="secondary" pending={pending} disabled={!reason.trim()} onClick={() => run(() => rejectHandover({ handoverId, reason }), t('wh.handover.rejected'))}>
          {t('wh.sales.reject')}
        </Button>
      </div>
    </div>
  );
}

/** Record an expense. A partner posts it at once; a rep's waits for approval. */
export function ExpenseForm({ today, isRep }: { today: string; isRep: boolean }) {
  const t = useT();
  const router = useRouter();
  const currencies = useCurrencyOptions();
  const form = useActionForm(
    (v) => settle(() => postExpense({ category: v.category ?? 'OTHER', amount: v.amount ?? '', currency: v.currency ?? 'IQD', ...(isRep ? {} : { date: v.date ?? '' }), note: v.note || null })),
    {
      validate: (v) => requireFields(v, { amount: t('wh.collect.amount') }),
      onSuccess: (data: { status: string }) => {
        toast.success(data.status === 'PENDING' ? t('wh.expenses.sentForApproval') : t('wh.expenses.posted'));
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['category', 'amount', 'currency', 'date', 'note']} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label={t('wh.expenses.category')}>
          <Select name="category" defaultValue="FUEL" options={CATEGORIES.map((c) => ({ value: c, label: t(`wh.expenses.cat.${c}`) }))} />
        </Field>
        <Field label={t('wh.collect.amount')} error={form.fieldError('amount')}>
          <Input name="amount" inputMode="decimal" dir="ltr" />
        </Field>
        <Field label={t('wh.purchases.currency')}>
          <Select name="currency" defaultValue="IQD" options={currencies} />
        </Field>
        {!isRep && (
          <Field label={t('wh.purchases.date')}>
            <Input name="date" type="date" defaultValue={today} dir="ltr" />
          </Field>
        )}
      </div>
      <Field label={t('wh.expenses.note')}>
        <Input name="note" dir="auto" />
      </Field>
      {isRep && <p className="text-sm text-muted">{t('wh.expenses.repHint')}</p>}
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.expenses.save')}
        </Button>
      </div>
    </form>
  );
}

/** Approve (paid from the rep's custody) or reject a rep's expense. */
export function ExpenseDecision({ expenseId }: { expenseId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const run = (call: () => Promise<ActionResult<unknown>>, done: string) =>
    start(async () => {
      const result = await settle(call);
      if (result.ok) {
        toast.success(done);
        router.refresh();
      } else toast.error(describeFailure(t, locale, result.error).message);
    });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Button type="button" variant="primary" pending={pending} onClick={() => run(() => approveExpense({ expenseId }), t('wh.expenses.approved'))}>
        {t('wh.sales.approve')}
      </Button>
      <Field label={t('wh.purchases.reason')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
      </Field>
      <Button type="button" variant="secondary" pending={pending} disabled={!reason.trim()} onClick={() => run(() => rejectExpense({ expenseId, reason }), t('wh.expenses.rejected'))}>
        {t('wh.sales.reject')}
      </Button>
    </div>
  );
}
