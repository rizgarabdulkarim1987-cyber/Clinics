'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { receiveFromRep } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, Field, Input } from '@/studio/ui';

/** The office takes cash from a rep: one box per currency he holds, filled with all of it, so the usual case is one tap. */
export function ReceiveFromRepForm({ repId, available }: { repId: string; available: { currency: string; available: string }[] }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(available.map((a) => [a.currency, a.available])));
  const amounts = available.map((a) => ({ currency: a.currency, amount: (values[a.currency] ?? '').trim() })).filter((a) => a.amount !== '' && Number(a.amount) > 0);
  if (available.length === 0) return <p className="text-base text-muted">{t('wh.reps.nothing')}</p>;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await settle(() => receiveFromRep({ repId, amounts }));
          if (!result.ok) {
            toast.error(describeFailure(t, locale, result.error).message);
            return;
          }
          toast.success(t('wh.reps.received'));
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {available.map((a) => (
          <Field key={a.currency} label={`${t(`wh.currency.${a.currency}`)} · ${t('wh.handover.available')} ${Number(a.available).toLocaleString('en-US')}`}>
            <Input value={values[a.currency] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [a.currency]: e.target.value }))} inputMode="decimal" dir="ltr" />
          </Field>
        ))}
      </div>
      <Button type="submit" variant="primary" pending={pending} disabled={amounts.length === 0}>
        {t('wh.reps.receive')}
      </Button>
    </form>
  );
}
