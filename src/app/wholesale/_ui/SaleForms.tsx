'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { approveSale, cancelSale, collectPayment, postSale, rejectSale, returnSale } from '@/app/wholesale/_actions/company';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { useActionForm, requireFields, type FormValues } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, Field, FormError, Input, Select } from '@/studio/ui';
import type { PurchaseItem } from './PurchaseForms';

const CURRENCIES = ['IQD', 'USD', 'IRT'] as const;

function useCurrencyOptions() {
  const t = useT();
  return CURRENCIES.map((c) => ({ value: c, label: t(`wh.currency.${c}`) }));
}

/** One sale line: the item, the unit it is sold in, the quantity and the price: the list price, a percent off, or a price typed in. */
function SaleLine({ prefix, items, form, withPrice }: { prefix: string; items: PurchaseItem[]; form: { fieldError: (name: string) => string | undefined }; withPrice: boolean }) {
  const t = useT();
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [mode, setMode] = useState('OFFICIAL');
  const units = (items.find((i) => i.id === itemId)?.units ?? ['PIECE']).map((u) => ({ value: u, label: t(`wh.unit.${u}`) }));
  return (
    <div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-5">
      <Field label={t('wh.purchases.item')}>
        <Select name={`${prefix}_item`} value={itemId} onChange={(e) => setItemId(e.target.value)} options={items.map((i) => ({ value: i.id, label: i.label }))} />
      </Field>
      <Field label={t('wh.purchases.unit')}>
        <Select name={`${prefix}_unit`} key={itemId} options={units} />
      </Field>
      <Field label={t('wh.purchases.qty')} error={form.fieldError(`${prefix}_qty`)}>
        <Input name={`${prefix}_qty`} inputMode="decimal" dir="ltr" />
      </Field>
      {withPrice ? (
        <>
          <Field label={t('wh.sales.priceMode')}>
            <Select
              name={`${prefix}_mode`}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              options={[
                { value: 'OFFICIAL', label: t('wh.sales.priceOfficial') },
                { value: 'PERCENT', label: t('wh.sales.pricePercent') },
                { value: 'MANUAL', label: t('wh.sales.priceManual') },
              ]}
            />
          </Field>
          {mode !== 'OFFICIAL' && (
            <Field label={mode === 'PERCENT' ? t('wh.sales.percentOff') : t('wh.sales.manualPrice')} error={form.fieldError(`${prefix}_value`)}>
              <Input name={`${prefix}_value`} inputMode="decimal" dir="ltr" />
            </Field>
          )}
        </>
      ) : null}
    </div>
  );
}

function linesOf(v: FormValues, prefix: string, count: number, withPrice: boolean) {
  return Array.from({ length: count }, (_, i) => {
    const p = `${prefix}${i}`;
    const mode = withPrice ? (v[`${p}_mode`] ?? 'OFFICIAL') : 'OFFICIAL';
    return {
      itemId: v[`${p}_item`] ?? '',
      unit: v[`${p}_unit`] ?? 'PIECE',
      qty: v[`${p}_qty`] ?? '',
      mode,
      percent: mode === 'PERCENT' ? v[`${p}_value`] || null : null,
      manual: mode === 'MANUAL' ? v[`${p}_value`] || null : null,
    };
  });
}

export function SaleForm({
  customers,
  warehouses,
  items,
  today,
  isRep,
}: {
  customers: { id: string; name: string }[];
  warehouses: { id: string; label: string }[];
  items: PurchaseItem[];
  today: string;
  isRep: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const currencies = useCurrencyOptions();
  const [count, setCount] = useState(1);
  const [mode, setMode] = useState('CASH');
  const form = useActionForm(
    (v) =>
      settle(() =>
        postSale({
          customerId: v.customerId ?? '',
          ...(isRep ? {} : { date: v.date ?? '' }),
          currency: v.currency ?? 'IQD',
          paymentMode: v.paymentMode ?? 'CASH',
          warehouseId: v.warehouseId ?? '',
          dueDate: v.dueDate || null,
          lines: linesOf(v, 'l', count, true),
        }),
      ),
    {
      validate: (v) => {
        const missing: Record<string, string> = {};
        for (let i = 0; i < count; i++) {
          if (!v[`l${i}_qty`]) missing[`l${i}_qty`] = t('wh.purchases.needQty');
          if ((v[`l${i}_mode`] ?? 'OFFICIAL') !== 'OFFICIAL' && !v[`l${i}_value`]) missing[`l${i}_value`] = t('wh.sales.needValue');
        }
        return Object.keys(missing).length ? missing : null;
      },
      onSuccess: (data: { status: string }) => {
        toast.success(data.status === 'PENDING_APPROVAL' ? t('wh.sales.held') : t('wh.sales.posted'));
        setCount(1);
        router.refresh();
      },
    },
  );
  if (customers.length === 0) return <p className="text-base text-muted">{t('wh.sales.needCustomer')}</p>;
  if (warehouses.length === 0) return <p className="text-base text-muted">{t('wh.sales.needWarehouse')}</p>;
  if (items.length === 0) return <p className="text-base text-muted">{t('wh.purchases.needItem')}</p>;
  return (
    <form {...form.props} className="flex flex-col gap-5">
      <FormError form={form} fields={['customerId', 'date', 'currency', 'paymentMode', 'warehouseId', 'dueDate']} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('wh.sales.customer')}>
          <Select name="customerId" options={customers.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label={t('wh.sales.warehouse')}>
          <Select name="warehouseId" options={warehouses.map((w) => ({ value: w.id, label: w.label }))} />
        </Field>
        {!isRep && (
          <Field label={t('wh.purchases.date')}>
            <Input name="date" type="date" defaultValue={today} dir="ltr" />
          </Field>
        )}
        <Field label={t('wh.purchases.currency')}>
          <Select name="currency" defaultValue="IQD" options={currencies} />
        </Field>
        <Field label={t('wh.purchases.paymentMode')}>
          <Select
            name="paymentMode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={[
              { value: 'CASH', label: t('wh.purchases.cash') },
              { value: 'CREDIT', label: t('wh.purchases.credit') },
            ]}
          />
        </Field>
        {mode === 'CREDIT' && (
          <Field label={t('wh.purchases.dueDate')} optional>
            <Input name="dueDate" type="date" dir="ltr" />
          </Field>
        )}
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-semibold">{t('wh.purchases.lines')}</legend>
        {isRep && <p className="text-sm text-muted">{t('wh.sales.repHint')}</p>}
        {Array.from({ length: count }, (_, i) => (
          <SaleLine key={i} prefix={`l${i}`} items={items} form={form} withPrice />
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setCount((n) => Math.min(n + 1, 500))}>
            {t('wh.purchases.addLine')}
          </Button>
          {count > 1 && (
            <Button type="button" variant="secondary" onClick={() => setCount((n) => n - 1)}>
              {t('wh.purchases.removeLine')}
            </Button>
          )}
        </div>
      </fieldset>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.sales.post')}
        </Button>
      </div>
    </form>
  );
}

/** Collects money from a customer in any currency; the books convert at the day's rate. With a sale, settles that sale only. */
export function CollectForm({ customerId, saleId, currency, today, isRep }: { customerId: string; saleId?: string; currency: string; today: string; isRep: boolean }) {
  const t = useT();
  const router = useRouter();
  const currencies = useCurrencyOptions();
  const form = useActionForm(
    (v) => settle(() => collectPayment({ customerId, saleId: saleId ?? null, amount: v.amount ?? '', currency: v.currency ?? currency, ...(isRep ? {} : { date: v.date ?? '' }) })),
    {
      validate: (v) => requireFields(v, { amount: t('wh.collect.amount') }),
      onSuccess: () => {
        toast.success(t('wh.collect.done'));
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['amount', 'currency', 'date']} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('wh.collect.amount')} error={form.fieldError('amount')}>
          <Input name="amount" inputMode="decimal" dir="ltr" />
        </Field>
        <Field label={t('wh.purchases.currency')}>
          <Select name="currency" defaultValue={currency} options={currencies} />
        </Field>
        {!isRep && (
          <Field label={t('wh.purchases.date')}>
            <Input name="date" type="date" defaultValue={today} dir="ltr" />
          </Field>
        )}
      </div>
      <p className="text-sm text-muted">{t('wh.collect.hint')}</p>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.collect.button')}
        </Button>
      </div>
    </form>
  );
}

export function CancelSaleForm({ saleId }: { saleId: string }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm((v) => settle(() => cancelSale({ saleId, reason: v.reason ?? '' })), {
    validate: (v) => requireFields(v, { reason: t('wh.purchases.reason') }),
    onSuccess: () => {
      toast.success(t('wh.sales.cancelled'));
      router.refresh();
    },
  });
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['reason']} />
      <p className="text-sm text-muted">{t('wh.sales.cancelHint')}</p>
      <Field label={t('wh.purchases.reason')} error={form.fieldError('reason')}>
        <Input name="reason" maxLength={300} dir="auto" />
      </Field>
      <div>
        <Button type="submit" variant="danger" pending={form.pending}>
          {t('wh.sales.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Approve or reject a rep's held sale. */
export function ApproveButtons({ saleId }: { saleId: string }) {
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
      } else {
        toast.error(describeFailure(t, locale, result.error).message);
      }
    });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Button type="button" variant="primary" pending={pending} onClick={() => run(() => approveSale({ saleId }), t('wh.sales.approved'))}>
        {t('wh.sales.approve')}
      </Button>
      <Field label={t('wh.purchases.reason')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
      </Field>
      <Button type="button" variant="secondary" pending={pending} disabled={!reason.trim()} onClick={() => run(() => rejectSale({ saleId, reason }), t('wh.sales.rejected'))}>
        {t('wh.sales.reject')}
      </Button>
    </div>
  );
}

/** A return: the lines coming back and their condition, how it is settled, and optionally goods given in exchange. */
export function ReturnSaleForm({
  saleId,
  paymentMode,
  lines,
  items,
}: {
  saleId: string;
  paymentMode: string;
  lines: { id: string; label: string; unit: string; qty: string }[];
  items: PurchaseItem[];
}) {
  const t = useT();
  const router = useRouter();
  const [exchange, setExchange] = useState(0);
  const form = useActionForm(
    (v) =>
      settle(() =>
        returnSale({
          saleId,
          refund: v.refund ?? 'CASH',
          lines: lines.filter((l) => v[`r_${l.id}`]).map((l) => ({ saleLineId: l.id, qty: v[`r_${l.id}`], condition: v[`c_${l.id}`] ?? 'GOOD' })),
          exchange: exchange > 0 ? { lines: linesOf(v, 'x', exchange, false) } : null,
        }),
      ),
    {
      validate: (v) => (lines.some((l) => v[`r_${l.id}`]) ? null : { [`r_${lines[0]?.id}`]: t('wh.purchases.returnNeedsQty') }),
      onSuccess: () => {
        toast.success(t('wh.sales.returned'));
        setExchange(0);
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['refund']} />
      <p className="text-sm text-muted">{t('wh.sales.returnHint')}</p>
      <div className="grid gap-3">
        {lines.map((l) => (
          <div key={l.id} className="grid gap-3 sm:grid-cols-2">
            <Field label={`${l.label} (${t(`wh.unit.${l.unit}`)}, ${t('wh.sales.sold')} ${l.qty})`} optional error={form.fieldError(`r_${l.id}`)}>
              <Input name={`r_${l.id}`} inputMode="decimal" dir="ltr" />
            </Field>
            <Field label={t('wh.sales.condition')}>
              <Select
                name={`c_${l.id}`}
                options={[
                  { value: 'GOOD', label: t('wh.sales.conditionGood') },
                  { value: 'DAMAGED', label: t('wh.sales.conditionDamaged') },
                ]}
              />
            </Field>
          </div>
        ))}
      </div>
      <Field label={t('wh.sales.refund')}>
        <Select
          name="refund"
          defaultValue={paymentMode === 'CREDIT' ? 'DEBT_OFFSET' : 'CASH'}
          options={[
            ...(paymentMode === 'CREDIT' ? [{ value: 'DEBT_OFFSET', label: t('wh.sales.refundDebt') }] : []),
            { value: 'CASH', label: t('wh.sales.refundCash') },
          ]}
        />
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-semibold">{t('wh.sales.exchange')}</legend>
        <p className="text-sm text-muted">{t('wh.sales.exchangeHint')}</p>
        {Array.from({ length: exchange }, (_, i) => (
          <SaleLine key={i} prefix={`x${i}`} items={items} form={form} withPrice={false} />
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setExchange((n) => Math.min(n + 1, 50))}>
            {t('wh.sales.addExchange')}
          </Button>
          {exchange > 0 && (
            <Button type="button" variant="secondary" onClick={() => setExchange((n) => n - 1)}>
              {t('wh.purchases.removeLine')}
            </Button>
          )}
        </div>
      </fieldset>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.sales.returnButton')}
        </Button>
      </div>
    </form>
  );
}
