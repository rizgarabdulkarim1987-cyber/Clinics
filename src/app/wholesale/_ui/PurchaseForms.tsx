'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { addLandedCost, cancelPurchase, paySupplier, postPurchase, returnPurchase, setRate } from '@/app/wholesale/_actions/company';
import { useActionForm, requireFields, type FormValues } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, Field, FormError, Input, Select } from '@/studio/ui';

const CURRENCIES = ['IQD', 'USD', 'IRT'] as const;
const COST_KINDS = ['SHIPPING', 'CUSTOMS', 'CLEARANCE', 'TRANSPORT', 'OTHER'] as const;

/** One purchase unit an item can be bought in. */
export interface PurchaseItem {
  id: string;
  label: string;
  units: string[];
}

function useCurrencyOptions() {
  const t = useT();
  return CURRENCIES.map((c) => ({ value: c, label: t(`wh.currency.${c}`) }));
}

/**
 * The day's rates, entered the easy way: dinars for one dollar, and tomans for one dollar. The toman is worth far
 * less than a dinar, so its own rate (dinars per toman) would be a tiny number like 0.0147; it is worked out from the two.
 */
export function RateForm({ today, usdByDate }: { today: string; usdByDate: Record<string, string> }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    async (v) => {
      const date = v.date ?? '';
      const usd = (v.usd ?? '').replace(/,/g, '').trim();
      const irt = (v.irt ?? '').replace(/,/g, '').trim();
      if (usd) {
        const r = await settle(() => setRate({ date, currency: 'USD', iqdPer: usd }));
        if (!r.ok) return r;
      }
      if (irt) {
        const usdRate = usd || usdByDate[date];
        const per = Number(irt);
        if (!usdRate || !(per > 0)) return { ok: false as const, error: { code: 'INVALID' as const, message: t('wh.rates.needUsd') } };
        return settle(() => setRate({ date, currency: 'IRT', iqdPer: (Number(usdRate) / per).toFixed(8) }));
      }
      return settle(() => setRate({ date, currency: 'USD', iqdPer: usd }));
    },
    {
      validate: (v) => (v.usd?.trim() || v.irt?.trim() ? {} : requireFields(v, { usd: t('wh.rates.usdIn') })),
      onSuccess: () => {
        toast.success(t('wh.common.saved'));
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['date', 'usd', 'irt']} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('wh.rates.date')} error={form.fieldError('date')}>
          <Input name="date" type="date" defaultValue={form.value('date') ?? today} dir="ltr" />
        </Field>
        <Field label={t('wh.rates.usdIn')} error={form.fieldError('usd')}>
          <Input name="usd" inputMode="decimal" dir="ltr" placeholder="1480" />
        </Field>
        <Field label={t('wh.rates.irtPerUsd')} error={form.fieldError('irt')}>
          <Input name="irt" inputMode="decimal" dir="ltr" placeholder="100000" />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.common.save')}
        </Button>
      </div>
    </form>
  );
}

/** A new purchase: a supplier, the currency, any number of lines by carton, piece or ton, and the extra costs of a foreign purchase. */
export function PurchaseForm({
  suppliers,
  items,
  warehouses,
  today,
}: {
  suppliers: { id: string; name: string; isForeign: boolean }[];
  items: PurchaseItem[];
  warehouses: { id: string; label: string }[];
  today: string;
}) {
  const t = useT();
  const router = useRouter();
  const currencies = useCurrencyOptions();
  const [lineCount, setLineCount] = useState(1);
  const [costCount, setCostCount] = useState(0);
  const [mode, setMode] = useState('CREDIT');
  const form = useActionForm(
    (v) => {
      const lines = Array.from({ length: lineCount }, (_, i) => ({
        itemId: v[`l${i}_item`] ?? '',
        unit: v[`l${i}_unit`] ?? 'PIECE',
        qty: v[`l${i}_qty`] ?? '',
        unitPrice: v[`l${i}_price`] ?? '',
        expiry: v[`l${i}_expiry`] || null,
      }));
      const landedCosts = Array.from({ length: costCount }, (_, i) => ({
        kind: v[`c${i}_kind`] ?? 'SHIPPING',
        amount: v[`c${i}_amount`] ?? '',
        currency: v[`c${i}_currency`] ?? 'USD',
        paymentMode: v[`c${i}_mode`] ?? 'CASH',
      }));
      return settle(() =>
        postPurchase({
          supplierId: v.supplierId ?? '',
          date: v.date ?? '',
          currency: v.currency ?? 'USD',
          paymentMode: v.paymentMode ?? 'CREDIT',
          dueDate: v.dueDate || null,
          warehouseId: v.warehouseId || null,
          lines,
          landedCosts,
        }),
      );
    },
    {
      validate: (v: FormValues) => {
        const missing: Record<string, string> = {};
        for (let i = 0; i < lineCount; i++) {
          if (!v[`l${i}_qty`]) missing[`l${i}_qty`] = t('wh.purchases.needQty');
          if (!v[`l${i}_price`]) missing[`l${i}_price`] = t('wh.purchases.needPrice');
        }
        for (let i = 0; i < costCount; i++) if (!v[`c${i}_amount`]) missing[`c${i}_amount`] = t('wh.purchases.needAmount');
        return Object.keys(missing).length ? missing : null;
      },
      onSuccess: () => {
        toast.success(t('wh.purchases.posted'));
        setLineCount(1);
        setCostCount(0);
        router.refresh();
      },
    },
  );
  if (suppliers.length === 0) return <p className="text-base text-muted">{t('wh.purchases.needSupplier')}</p>;
  if (items.length === 0) return <p className="text-base text-muted">{t('wh.purchases.needItem')}</p>;
  const unitOptions = (itemId: string) => (items.find((i) => i.id === itemId)?.units ?? ['PIECE']).map((u) => ({ value: u, label: t(`wh.unit.${u}`) }));
  return (
    <form {...form.props} className="flex flex-col gap-5">
      <FormError form={form} fields={['supplierId', 'date', 'currency', 'paymentMode', 'dueDate', 'warehouseId']} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('wh.purchases.supplier')}>
          <Select name="supplierId" options={suppliers.map((s) => ({ value: s.id, label: `${s.name} · ${s.isForeign ? t('wh.suppliers.foreign') : t('wh.suppliers.local')}` }))} />
        </Field>
        <Field label={t('wh.purchases.date')} error={form.fieldError('date')}>
          <Input name="date" type="date" defaultValue={form.value('date') ?? today} dir="ltr" />
        </Field>
        <Field label={t('wh.purchases.currency')}>
          <Select name="currency" defaultValue={form.value('currency') ?? 'USD'} options={currencies} />
        </Field>
        <Field label={t('wh.purchases.paymentMode')}>
          <Select
            name="paymentMode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={[
              { value: 'CREDIT', label: t('wh.purchases.credit') },
              { value: 'CASH', label: t('wh.purchases.cash') },
            ]}
          />
        </Field>
        {mode === 'CREDIT' && (
          <Field label={t('wh.purchases.dueDate')} optional>
            <Input name="dueDate" type="date" dir="ltr" />
          </Field>
        )}
        {warehouses.length > 1 && (
          <Field label={t('wh.purchases.warehouse')} optional>
            <Select name="warehouseId" options={warehouses.map((w) => ({ value: w.id, label: w.label }))} />
          </Field>
        )}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-semibold">{t('wh.purchases.lines')}</legend>
        {Array.from({ length: lineCount }, (_, i) => (
          <LineRow key={i} index={i} items={items} unitOptions={unitOptions} form={form} />
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setLineCount((n) => Math.min(n + 1, 500))}>
            {t('wh.purchases.addLine')}
          </Button>
          {lineCount > 1 && (
            <Button type="button" variant="secondary" onClick={() => setLineCount((n) => n - 1)}>
              {t('wh.purchases.removeLine')}
            </Button>
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-semibold">{t('wh.purchases.landed')}</legend>
        <p className="text-sm text-muted">{t('wh.purchases.landedHint')}</p>
        {Array.from({ length: costCount }, (_, i) => (
          <div key={i} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-4">
            <Field label={t('wh.purchases.costKind')}>
              <Select name={`c${i}_kind`} options={COST_KINDS.map((k) => ({ value: k, label: t(`wh.cost.${k}`) }))} />
            </Field>
            <Field label={t('wh.purchases.costAmount')} error={form.fieldError(`c${i}_amount`)}>
              <Input name={`c${i}_amount`} inputMode="decimal" dir="ltr" />
            </Field>
            <Field label={t('wh.purchases.currency')}>
              <Select name={`c${i}_currency`} defaultValue="USD" options={currencies} />
            </Field>
            <Field label={t('wh.purchases.paymentMode')}>
              <Select
                name={`c${i}_mode`}
                options={[
                  { value: 'CASH', label: t('wh.purchases.cash') },
                  { value: 'CREDIT', label: t('wh.purchases.credit') },
                ]}
              />
            </Field>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setCostCount((n) => Math.min(n + 1, 20))}>
            {t('wh.purchases.addCost')}
          </Button>
          {costCount > 0 && (
            <Button type="button" variant="secondary" onClick={() => setCostCount((n) => n - 1)}>
              {t('wh.purchases.removeCost')}
            </Button>
          )}
        </div>
      </fieldset>

      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.purchases.post')}
        </Button>
      </div>
    </form>
  );
}

function LineRow({
  index,
  items,
  unitOptions,
  form,
}: {
  index: number;
  items: PurchaseItem[];
  unitOptions: (itemId: string) => { value: string; label: string }[];
  form: { fieldError: (name: string) => string | undefined };
}) {
  const t = useT();
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  return (
    <div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-5">
      <Field label={t('wh.purchases.item')}>
        <Select name={`l${index}_item`} value={itemId} onChange={(e) => setItemId(e.target.value)} options={items.map((i) => ({ value: i.id, label: i.label }))} />
      </Field>
      <Field label={t('wh.purchases.unit')}>
        <Select name={`l${index}_unit`} key={itemId} options={unitOptions(itemId)} />
      </Field>
      <Field label={t('wh.purchases.qty')} error={form.fieldError(`l${index}_qty`)}>
        <Input name={`l${index}_qty`} inputMode="decimal" dir="ltr" />
      </Field>
      <Field label={t('wh.purchases.unitPrice')} error={form.fieldError(`l${index}_price`)}>
        <Input name={`l${index}_price`} inputMode="decimal" dir="ltr" />
      </Field>
      <Field label={t('wh.purchases.expiry')} optional>
        <Input name={`l${index}_expiry`} type="date" dir="ltr" />
      </Field>
    </div>
  );
}

export function LandedCostForm({ purchaseId, currency, today }: { purchaseId: string; currency: string; today: string }) {
  const t = useT();
  const router = useRouter();
  const currencies = useCurrencyOptions();
  const form = useActionForm(
    (v) =>
      settle(() =>
        addLandedCost({ purchaseId, kind: v.kind ?? 'SHIPPING', amount: v.amount ?? '', currency: v.currency ?? currency, date: v.date ?? '', paymentMode: v.paymentMode ?? 'CASH' }),
      ),
    {
      validate: (v) => requireFields(v, { amount: t('wh.purchases.costAmount') }),
      onSuccess: () => {
        toast.success(t('wh.common.saved'));
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['kind', 'amount', 'currency', 'date', 'paymentMode']} />
      <div className="grid gap-4 sm:grid-cols-5">
        <Field label={t('wh.purchases.costKind')}>
          <Select name="kind" options={COST_KINDS.map((k) => ({ value: k, label: t(`wh.cost.${k}`) }))} />
        </Field>
        <Field label={t('wh.purchases.costAmount')} error={form.fieldError('amount')}>
          <Input name="amount" inputMode="decimal" dir="ltr" />
        </Field>
        <Field label={t('wh.purchases.currency')}>
          <Select name="currency" defaultValue={currency} options={currencies} />
        </Field>
        <Field label={t('wh.purchases.date')}>
          <Input name="date" type="date" defaultValue={today} dir="ltr" />
        </Field>
        <Field label={t('wh.purchases.paymentMode')}>
          <Select
            name="paymentMode"
            options={[
              { value: 'CASH', label: t('wh.purchases.cash') },
              { value: 'CREDIT', label: t('wh.purchases.credit') },
            ]}
          />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.purchases.addCost')}
        </Button>
      </div>
    </form>
  );
}

/** Pays a supplier in any currency; the books convert at the day's rate. With a purchase, settles that purchase only. */
export function PayForm({ supplierId, purchaseId, currency, today }: { supplierId: string; purchaseId?: string; currency: string; today: string }) {
  const t = useT();
  const router = useRouter();
  const currencies = useCurrencyOptions();
  const form = useActionForm(
    (v) => settle(() => paySupplier({ supplierId, purchaseId: purchaseId ?? null, amount: v.amount ?? '', currency: v.currency ?? currency, date: v.date ?? '' })),
    {
      validate: (v) => requireFields(v, { amount: t('wh.pay.amount') }),
      onSuccess: () => {
        toast.success(t('wh.pay.done'));
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['amount', 'currency', 'date']} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('wh.pay.amount')} error={form.fieldError('amount')}>
          <Input name="amount" inputMode="decimal" dir="ltr" />
        </Field>
        <Field label={t('wh.purchases.currency')}>
          <Select name="currency" defaultValue={currency} options={currencies} />
        </Field>
        <Field label={t('wh.purchases.date')}>
          <Input name="date" type="date" defaultValue={today} dir="ltr" />
        </Field>
      </div>
      <p className="text-sm text-muted">{t('wh.pay.hint')}</p>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.pay.button')}
        </Button>
      </div>
    </form>
  );
}

export function CancelPurchaseForm({ purchaseId }: { purchaseId: string }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm((v) => settle(() => cancelPurchase({ purchaseId, reason: v.reason ?? '' })), {
    validate: (v) => requireFields(v, { reason: t('wh.purchases.reason') }),
    onSuccess: () => {
      toast.success(t('wh.purchases.cancelled'));
      router.refresh();
    },
  });
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['reason']} />
      <p className="text-sm text-muted">{t('wh.purchases.cancelHint')}</p>
      <Field label={t('wh.purchases.reason')} error={form.fieldError('reason')}>
        <Input name="reason" maxLength={300} dir="auto" />
      </Field>
      <div>
        <Button type="submit" variant="danger" pending={form.pending}>
          {t('wh.purchases.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function ReturnPurchaseForm({ purchaseId, paymentMode, lines }: { purchaseId: string; paymentMode: string; lines: { id: string; label: string; unit: string; qty: string }[] }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    (v) =>
      settle(() =>
        returnPurchase({
          purchaseId,
          refund: v.refund || null,
          lines: lines.filter((l) => v[`r_${l.id}`]).map((l) => ({ purchaseLineId: l.id, qty: v[`r_${l.id}`] })),
        }),
      ),
    {
      validate: (v) => (lines.some((l) => v[`r_${l.id}`]) ? null : { [`r_${lines[0]?.id}`]: t('wh.purchases.returnNeedsQty') }),
      onSuccess: () => {
        toast.success(t('wh.purchases.returned'));
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['refund']} />
      <p className="text-sm text-muted">{t('wh.purchases.returnHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {lines.map((l) => (
          <Field key={l.id} label={`${l.label} (${t(`wh.unit.${l.unit}`)}, ${t('wh.purchases.bought')} ${l.qty})`} optional error={form.fieldError(`r_${l.id}`)}>
            <Input name={`r_${l.id}`} inputMode="decimal" dir="ltr" />
          </Field>
        ))}
      </div>
      <Field label={t('wh.purchases.refund')}>
        <Select
          name="refund"
          defaultValue={paymentMode === 'CREDIT' ? 'DEBT_OFFSET' : 'CASH'}
          options={[
            ...(paymentMode === 'CREDIT' ? [{ value: 'DEBT_OFFSET', label: t('wh.purchases.refundDebt') }] : []),
            { value: 'CASH', label: t('wh.purchases.refundCash') },
          ]}
        />
      </Field>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.purchases.returnButton')}
        </Button>
      </div>
    </form>
  );
}
