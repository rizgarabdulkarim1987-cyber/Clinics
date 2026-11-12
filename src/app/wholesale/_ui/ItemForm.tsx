'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createItem, setPrices, updateItem } from '@/app/wholesale/_actions/company';
import { useActionForm, requireFields } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, Field, FormError, Input, Select } from '@/studio/ui';

const BASE_UNITS = ['PIECE', 'KG', 'TON', 'CARTON'] as const;
const UNITS = [...BASE_UNITS, 'SACK_5', 'SACK_10', 'SACK_15', 'SACK_25', 'SINGLE'] as const;
type Unit = (typeof UNITS)[number];

export interface ItemRow {
  id: string;
  code: string;
  names: { ckb: string; ar: string; en: string };
  category: string | null;
  baseUnit: Unit;
  reorderPoint: string | null;
  units: { unit: Unit; factorToBase: string; barcode: string | null }[];
  prices: { unit: Unit; priceIqd: string; marketPriceIqd?: string | null }[];
}

const FIELDS = ['code', 'names', 'baseUnit', 'units', 'reorderPoint', 'category'] as const;

/** Creates an item, or edits one: its names, its smallest unit and what each larger unit holds of it. */
export function ItemForm({ item, onDone }: { item?: ItemRow; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const factor = (unit: Unit) => item?.units.find((u) => u.unit === unit)?.factorToBase ?? '';
  const form = useActionForm(
    (v) => {
      const base = (v.baseUnit as Unit) || 'PIECE';
      const units = UNITS.map((unit) => ({ unit, factorToBase: unit === base ? '1' : (v[`factor_${unit}`] ?? '').trim() })).filter((u) => u.factorToBase !== '');
      const body = {
        code: v.code ?? '',
        names: { ckb: v.nameCkb ?? '', ar: v.nameAr ?? '', en: v.nameEn ?? '' },
        category: v.category || null,
        baseUnit: base,
        units,
        reorderPoint: v.reorderPoint || null,
      };
      return settle(() => (item ? updateItem({ itemId: item.id, item: body }) : createItem({ item: body })));
    },
    {
      validate: (v) => {
        const errors = requireFields(v, { code: t('wh.catalog.code') });
        if (!(v.nameCkb || v.nameAr || v.nameEn)?.trim()) errors.names = t('wh.catalog.namesHint');
        return errors;
      },
      onSuccess: () => {
        toast.success(t('wh.common.saved'));
        router.refresh();
        onDone?.();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={FIELDS} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('wh.catalog.code')} error={form.fieldError('code')}>
          <Input name="code" defaultValue={form.value('code') ?? item?.code ?? ''} maxLength={60} dir="auto" />
        </Field>
        <Field label={t('wh.catalog.category')} optional error={form.fieldError('category')}>
          <Input name="category" defaultValue={form.value('category') ?? item?.category ?? ''} maxLength={80} dir="auto" />
        </Field>
        <Field label={t('wh.catalog.nameCkb')} error={form.fieldError('names')} hint={t('wh.catalog.namesHint')}>
          <Input name="nameCkb" defaultValue={form.value('nameCkb') ?? item?.names.ckb ?? ''} maxLength={120} dir="rtl" />
        </Field>
        <Field label={t('wh.catalog.nameAr')}>
          <Input name="nameAr" defaultValue={form.value('nameAr') ?? item?.names.ar ?? ''} maxLength={120} dir="rtl" />
        </Field>
        <Field label={t('wh.catalog.nameEn')}>
          <Input name="nameEn" defaultValue={form.value('nameEn') ?? item?.names.en ?? ''} maxLength={120} dir="ltr" />
        </Field>
        <Field label={t('wh.catalog.reorder')} optional error={form.fieldError('reorderPoint')}>
          <Input name="reorderPoint" inputMode="decimal" defaultValue={form.value('reorderPoint') ?? item?.reorderPoint ?? ''} dir="ltr" />
        </Field>
        <Field label={t('wh.catalog.baseUnit')} error={form.fieldError('baseUnit')}>
          <Select name="baseUnit" defaultValue={form.value('baseUnit') ?? item?.baseUnit ?? 'PIECE'} options={BASE_UNITS.map((u) => ({ value: u, label: t(`wh.unit.${u}`) }))} />
        </Field>
      </div>
      {item && (
        <div>
          <Button type="submit" variant="primary" pending={form.pending}>
            {t('wh.common.save')}
          </Button>
        </div>
      )}
      <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-semibold">{t('wh.catalog.units')}</legend>
        <p className="text-sm text-muted">{t('wh.catalog.unitFactorHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {UNITS.map((unit) => (
            <Field key={unit} label={t('wh.catalog.unitFactor', { base: t('wh.catalog.baseUnit'), unit: t(`wh.unit.${unit}`) })} optional>
              <Input name={`factor_${unit}`} inputMode="decimal" defaultValue={form.value(`factor_${unit}`) ?? factor(unit)} dir="ltr" />
            </Field>
          ))}
        </div>
      </fieldset>
      {!item && (
        <div>
          <Button type="submit" variant="primary" pending={form.pending}>
            {t('wh.common.save')}
          </Button>
        </div>
      )}
    </form>
  );
}

/** One IQD price per unit the item has. A price left empty is removed. */
export function PricesForm({ item, onDone }: { item: ItemRow; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    (v) =>
      settle(() =>
        setPrices({
          itemId: item.id,
          prices: item.units.map((u) => ({ unit: u.unit, priceIqd: (v[`price_${u.unit}`] ?? '').trim(), marketPriceIqd: (v[`market_${u.unit}`] ?? '').trim() })),
        }),
      ),
    {
      onSuccess: () => {
        toast.success(t('wh.common.saved'));
        router.refresh();
        onDone?.();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-3">
      <FormError form={form} fields={[]} />
      <p className="text-sm text-muted">{t('wh.catalog.pricesHint')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {item.units.map((u) => (
          <div key={u.unit} className="flex flex-col gap-2">
            <Field label={`${t(`wh.unit.${u.unit}`)} · ${t('wh.customers.type.WHOLESALE')} (IQD)`}>
              <Input name={`price_${u.unit}`} inputMode="decimal" defaultValue={form.value(`price_${u.unit}`) ?? item.prices.find((p) => p.unit === u.unit)?.priceIqd ?? ''} dir="ltr" />
            </Field>
            <Field label={`${t(`wh.unit.${u.unit}`)} · ${t('wh.customers.type.MARKET')} (IQD)`} optional>
              <Input name={`market_${u.unit}`} inputMode="decimal" defaultValue={form.value(`market_${u.unit}`) ?? item.prices.find((p) => p.unit === u.unit)?.marketPriceIqd ?? ''} dir="ltr" />
            </Field>
          </div>
        ))}
      </div>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.common.save')}
        </Button>
      </div>
    </form>
  );
}
