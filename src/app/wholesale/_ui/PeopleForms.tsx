'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { createRepWarehouse, deactivateStaff, provision, saveCustomer, saveSupplier, setStaff, transferToRep } from '@/app/wholesale/_actions/company';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { useActionForm, requireFields } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, Field, FormError, Input, Select } from '@/studio/ui';

export interface CityOption {
  id: string;
  label: string;
}

export function CustomerForm({
  customer,
  cities,
  reps,
}: {
  customer?: { id: string; name: string; phone: string | null; cityId: string; repId: string | null; creditLimitIqd: string | null; type?: 'WHOLESALE' | 'MARKET' };
  cities: CityOption[];
  reps: { userId: string; name: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    (v) =>
      settle(() =>
        saveCustomer({
          ...(customer ? { customerId: customer.id } : {}),
          customer: { name: v.name ?? '', phone: v.phone || null, cityId: v.cityId ?? '', repId: v.repId || null, creditLimitIqd: v.creditLimitIqd || null, type: v.type === 'MARKET' ? 'MARKET' : 'WHOLESALE' },
        }),
      ),
    {
      validate: (v) => requireFields(v, { name: t('wh.customers.name'), cityId: t('wh.customers.city') }),
      onSuccess: () => {
        toast.success(t('wh.common.saved'));
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['name', 'phone', 'cityId', 'repId', 'creditLimitIqd', 'type']} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('wh.customers.name')} error={form.fieldError('name')}>
          <Input name="name" defaultValue={form.value('name') ?? customer?.name ?? ''} maxLength={120} dir="auto" />
        </Field>
        <Field label={t('wh.customers.phone')} optional error={form.fieldError('phone')}>
          <Input name="phone" inputMode="tel" defaultValue={form.value('phone') ?? customer?.phone ?? ''} dir="ltr" />
        </Field>
        <Field label={t('wh.customers.type')} error={form.fieldError('type')}>
          <Select name="type" defaultValue={form.value('type') ?? customer?.type ?? 'WHOLESALE'} options={[{ value: 'WHOLESALE', label: t('wh.customers.type.WHOLESALE') }, { value: 'MARKET', label: t('wh.customers.type.MARKET') }]} />
        </Field>
        <Field label={t('wh.customers.city')} error={form.fieldError('cityId')}>
          <Select name="cityId" defaultValue={form.value('cityId') ?? customer?.cityId ?? cities[0]?.id ?? ''} options={cities.map((c) => ({ value: c.id, label: c.label }))} />
        </Field>
        <Field label={t('wh.customers.rep')} optional error={form.fieldError('repId')}>
          <Select name="repId" defaultValue={form.value('repId') ?? customer?.repId ?? ''} options={[{ value: '', label: t('wh.common.none') }, ...reps.map((r) => ({ value: r.userId, label: r.name }))]} />
        </Field>
        <Field label={t('wh.customers.credit')} optional error={form.fieldError('creditLimitIqd')}>
          <Input name="creditLimitIqd" inputMode="decimal" defaultValue={form.value('creditLimitIqd') ?? customer?.creditLimitIqd ?? ''} dir="ltr" />
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

export function SupplierForm({ supplier }: { supplier?: { id: string; name: string; phone: string | null; country: string | null; isForeign: boolean } }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    (v) =>
      settle(() =>
        saveSupplier({
          ...(supplier ? { supplierId: supplier.id } : {}),
          supplier: { name: v.name ?? '', phone: v.phone || null, country: v.country || null, isForeign: v.isForeign === 'true' },
        }),
      ),
    {
      validate: (v) => requireFields(v, { name: t('wh.suppliers.name') }),
      onSuccess: () => {
        toast.success(t('wh.common.saved'));
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['name', 'phone', 'country', 'isForeign']} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('wh.suppliers.name')} error={form.fieldError('name')}>
          <Input name="name" defaultValue={form.value('name') ?? supplier?.name ?? ''} maxLength={120} dir="auto" />
        </Field>
        <Field label={t('wh.suppliers.phone')} optional>
          <Input name="phone" inputMode="tel" defaultValue={form.value('phone') ?? supplier?.phone ?? ''} dir="ltr" />
        </Field>
        <Field label={t('wh.suppliers.country')} optional>
          <Input name="country" defaultValue={form.value('country') ?? supplier?.country ?? ''} maxLength={80} dir="auto" />
        </Field>
        <Field label={t('wh.suppliers.isForeign')}>
          <Select
            name="isForeign"
            defaultValue={form.value('isForeign') ?? String(supplier?.isForeign ?? false)}
            options={[
              { value: 'false', label: t('wh.suppliers.local') },
              { value: 'true', label: t('wh.suppliers.foreign') },
            ]}
          />
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

export function TransferForm({ items, warehouses }: { items: { id: string; label: string }[]; warehouses: { id: string; label: string }[] }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    (v) => settle(() => transferToRep({ itemId: v.itemId ?? '', toWarehouseId: v.toWarehouseId ?? '', qtyBase: v.qtyBase ?? '' })),
    {
      validate: (v) => requireFields(v, { qtyBase: t('wh.stock.transferQty') }),
      onSuccess: () => {
        toast.success(t('wh.stock.transferDone'));
        router.refresh();
      },
    },
  );
  if (warehouses.length === 0) return <p className="text-base text-muted">{t('wh.stock.noRepWarehouse')}</p>;
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['itemId', 'toWarehouseId', 'qtyBase']} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('wh.stock.transferItem')}>
          <Select name="itemId" options={items.map((i) => ({ value: i.id, label: i.label }))} />
        </Field>
        <Field label={t('wh.stock.transferTo')}>
          <Select name="toWarehouseId" options={warehouses.map((w) => ({ value: w.id, label: w.label }))} />
        </Field>
        <Field label={t('wh.stock.transferQty')} error={form.fieldError('qtyBase')}>
          <Input name="qtyBase" inputMode="decimal" dir="ltr" />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.stock.transferButton')}
        </Button>
      </div>
    </form>
  );
}

export function AddStaffForm() {
  const t = useT();
  const router = useRouter();
  const form = useActionForm((v) => settle(() => setStaff({ email: v.email ?? '', role: v.role ?? 'REP' })), {
    validate: (v) => requireFields(v, { email: t('wh.staff.email') }),
    onSuccess: () => {
      toast.success(t('wh.common.saved'));
      router.refresh();
    },
  });
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['email', 'role']} />
      <p className="text-sm text-muted">{t('wh.staff.addHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('wh.staff.email')} error={form.fieldError('email')}>
          <Input name="email" type="email" dir="ltr" autoComplete="off" />
        </Field>
        <Field label={t('wh.staff.role')}>
          <Select
            name="role"
            options={[
              { value: 'PARTNER', label: t('wh.role.PARTNER') },
              { value: 'REP', label: t('wh.role.REP') },
            ]}
          />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.staff.add')}
        </Button>
      </div>
    </form>
  );
}

/** A staff row's two actions: give a rep his own warehouse, and take a person off the company. */
export function StaffActions({ userId, role, hasWarehouse }: { userId: string; role: string; hasWarehouse: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
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
    <div className="flex flex-wrap gap-2">
      {role === 'REP' && !hasWarehouse && (
        <Button size="sm" disabled={pending} onClick={() => run(() => createRepWarehouse({ repUserId: userId }), t('wh.common.saved'))}>
          {t('wh.staff.giveWarehouse')}
        </Button>
      )}
      {role !== 'OWNER' && (
        <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => deactivateStaff({ userId }), t('wh.staff.removed'))}>
          {t('wh.staff.remove')}
        </Button>
      )}
    </div>
  );
}

export function SetupButton() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      pending={pending}
      onClick={() =>
        start(async () => {
          const result = await settle(() => provision());
          if (result.ok) router.refresh();
          else toast.error(describeFailure(t, locale, result.error).message);
        })
      }
    >
      {t('wh.home.setupButton')}
    </Button>
  );
}
