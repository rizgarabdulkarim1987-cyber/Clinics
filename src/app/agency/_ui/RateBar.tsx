'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { setAccountRate } from '@/app/studio/_actions/accounts';
import { parseRate } from '@/lib/accounts';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Input } from '@/studio/ui/Input';

/**
 * The exchange rate, always in reach in the header: whole dinars for one dollar. A new rate applies to entries typed from
 * then on; the sentence that says so shows only while a new rate is being typed, so the bar stays one small line.
 */
export function RateBar({ rate }: { rate: number | null }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(rate === null ? '' : String(rate));
  const [error, setError] = useState('');
  const parsed = parseRate(text);
  const changed = parsed.ok && parsed.rate !== rate;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!parsed.ok) {
      setError(t('accounts.error.rate'));
      return;
    }
    setError('');
    start(async () => {
      const result = await setAccountRate({ rate: text });
      if (result.ok) {
        setText(String(result.data.rate));
        toast.success(t('accounts.rate.saved'));
        router.refresh();
      } else {
        const failure = describeFailure(t, locale, result.error);
        setError(failure.fields?.rate ?? failure.message);
      }
    });
  };

  return (
    <form onSubmit={submit} aria-label={t('accounts.rate.label')} className="relative flex items-center gap-2">
      <span dir="ltr" className="inline-flex items-center gap-1.5 whitespace-nowrap text-base tabular-nums">
        <span className="text-muted">1 USD =</span>
        <Input
          aria-label={t('accounts.rate.label')}
          aria-invalid={error ? true : undefined}
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          className="w-24 text-end"
          placeholder="1500"
        />
        <span className="text-muted">IQD</span>
      </span>
      {changed && (
        <Button type="submit" size="sm" variant="primary" pending={pending}>
          {t('accounts.rate.save')}
        </Button>
      )}
      {(changed || error) && (
        <p
          role={error ? 'alert' : 'status'}
          className={`absolute end-0 top-full z-10 mt-2 w-72 rounded-md border bg-raised px-3 py-2 text-sm shadow-[0_6px_16px_rgb(0_0_0/0.12)] ${error ? 'border-danger text-danger' : 'border-line-strong text-muted'}`}
        >
          {error || t('accounts.rate.hint')}
        </p>
      )}
    </form>
  );
}
