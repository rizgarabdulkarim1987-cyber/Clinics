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
 * The exchange rate, always in reach on the one screen: whole dinars for one dollar. Dollars are added to dinars at this
 * rate in the combined lines; nothing is converted in what was recorded.
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
    <form onSubmit={submit} aria-label={t('accounts.rate.label')} className="flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium text-text">{t('accounts.rate.label')}</span>
        <span dir="ltr" className="inline-flex items-center gap-2 text-base tabular-nums">
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
            className="w-28 text-end"
            placeholder="1500"
          />
          <span className="text-muted">IQD</span>
        </span>
        <Button type="submit" variant="secondary" disabled={pending || !changed}>
          {t('accounts.rate.save')}
        </Button>
      </div>
      <p className={error ? 'text-sm text-danger' : 'text-sm text-muted'} role={error ? 'alert' : undefined}>
        {error || t('accounts.rate.hint')}
      </p>
    </form>
  );
}
