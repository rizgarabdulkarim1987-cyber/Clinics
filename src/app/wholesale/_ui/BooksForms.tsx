'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { closePeriod, reopenPeriod, saveSettings } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useActionForm } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, Field, FormError, Input, Select } from '@/studio/ui';

/** Close or reopen one month of the books. */
export function PeriodButton({ month, closed }: { month: string; closed: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      pending={pending}
      onClick={() =>
        start(async () => {
          const result = await settle(() => (closed ? reopenPeriod({ month }) : closePeriod({ month })));
          if (result.ok) {
            toast.success(closed ? t('wh.periods.reopened') : t('wh.periods.closed'));
            router.refresh();
          } else toast.error(describeFailure(t, locale, result.error).message);
        })
      }
    >
      {closed ? t('wh.periods.reopen') : t('wh.periods.close')}
    </Button>
  );
}

export function SettingsForm({ values }: { values: { requireApproval: boolean; creditLimitMode: string; defaultCurrency: string; expiryAlertDays: number } }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    (v) =>
      settle(() =>
        saveSettings({ requireApproval: v.requireApproval === 'true', creditLimitMode: v.creditLimitMode, defaultCurrency: v.defaultCurrency, expiryAlertDays: Number(v.expiryAlertDays) }),
      ),
    {
      onSuccess: () => {
        toast.success(t('wh.settings.saved'));
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-4">
      <FormError form={form} fields={['requireApproval', 'creditLimitMode', 'defaultCurrency', 'expiryAlertDays']} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('wh.settings.requireApproval')}>
          <Select name="requireApproval" defaultValue={String(values.requireApproval)} options={[{ value: 'false', label: t('wh.settings.no') }, { value: 'true', label: t('wh.settings.yes') }]} />
        </Field>
        <Field label={t('wh.settings.creditLimitMode')}>
          <Select name="creditLimitMode" defaultValue={values.creditLimitMode} options={[{ value: 'WARN', label: t('wh.settings.warn') }, { value: 'BLOCK', label: t('wh.settings.block') }]} />
        </Field>
        <Field label={t('wh.settings.defaultCurrency')}>
          <Select name="defaultCurrency" defaultValue={values.defaultCurrency} options={['IQD', 'USD', 'IRT'].map((c) => ({ value: c, label: t(`wh.currency.${c}`) }))} />
        </Field>
        <Field label={t('wh.settings.expiryAlertDays')}>
          <Input name="expiryAlertDays" inputMode="numeric" dir="ltr" defaultValue={String(values.expiryAlertDays)} />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="primary" pending={form.pending}>
          {t('wh.settings.save')}
        </Button>
      </div>
    </form>
  );
}
