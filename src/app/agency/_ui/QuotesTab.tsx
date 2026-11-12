'use client';

import { Archive, Check, FileText, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { archiveAccountQuote, createAccountQuote, decideAccountQuote } from '@/app/studio/_actions/accounts';
import type { AccountCurrency } from '@/lib/accounts';
import { quoteNumber, quoteState } from '@/server/accounts/quote-format';
import type { AccountsBook } from '@/server/studio/queries/accounts';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { parseAmountInput } from '@/studio/money-input';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { formatBook } from './money';

const CURRENCIES = [
  { value: 'IQD', label: 'IQD' },
  { value: 'USD', label: 'USD' },
];
const VALID_DAYS = ['7', '14', '30', '60'];

const BADGE: Record<ReturnType<typeof quoteState>, string> = {
  open: 'bg-accent-wash text-accent',
  accepted: 'bg-success-wash text-success',
  declined: 'bg-danger-wash text-danger',
  expired: 'bg-hover text-muted',
};

/**
 * The quotes tab: an offer made to a client before the work starts. An accepted quote becomes income the client owes;
 * a declined or run-out one stays on the list for the record. Each one opens as a printable page.
 */
export function QuotesTab({ book, today }: { book: AccountsBook; today: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [client, setClient] = useState('');
  const [service, setService] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<AccountCurrency>('USD');
  const [days, setDays] = useState('14');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ client?: string; service?: string; amount?: string }>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseAmountInput(amount, currency);
    const found = {
      ...(!client ? { client: t('accounts.plan.error.client') } : {}),
      ...(service.trim() === '' ? { service: t('accounts.plan.error.service') } : {}),
      ...(!parsed.ok || parsed.minor <= 0 ? { amount: t('accounts.error.amount') } : {}),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    start(async () => {
      const result = await createAccountQuote({ clientId: client, service, note, amount, currency, validDays: Number(days) });
      if (result.ok) {
        toast.success(t('accounts.quotes.created'));
        setService('');
        setAmount('');
        setNote('');
        router.refresh();
      } else toast.error(describeFailure(t, locale, result.error).message);
    });
  };

  const decide = (id: string, decision: 'ACCEPT' | 'DECLINE') =>
    start(async () => {
      const result = await decideAccountQuote({ id, decision });
      if (result.ok) {
        toast.success(t(decision === 'ACCEPT' ? 'accounts.quotes.accepted' : 'accounts.quotes.declined'));
        router.refresh();
      } else toast.error(describeFailure(t, locale, result.error).message);
    });

  const remove = (id: string) =>
    start(async () => {
      const result = await archiveAccountQuote({ id });
      if (result.ok) {
        toast.success(t('accounts.quotes.archived'));
        router.refresh();
      } else toast.error(describeFailure(t, locale, result.error).message);
    });

  const card = 'flex flex-col gap-4 rounded-lg border border-line bg-raised p-5 lg:max-h-full lg:min-h-0 lg:self-start lg:overflow-y-auto';

  return (
    <div className="flex flex-col gap-4 lg:grid lg:h-full lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-5">
      <section aria-labelledby="quotes-title" className={card}>
        <div>
          <h2 id="quotes-title" className="text-md font-semibold">
            {t('accounts.quotes.title')}
          </h2>
          <p className="text-sm text-muted">{t('accounts.quotes.hint')}</p>
        </div>

        {book.quotes.length === 0 ? (
          <p className="rounded-md bg-surface px-4 py-3 text-sm text-muted">{t('accounts.quotes.empty')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {book.quotes.map((quote) => {
              const state = quoteState(quote, today);
              return (
                <li key={quote.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span dir="ltr" className="text-sm tabular-nums text-muted">
                        {quoteNumber(quote.number)}
                      </span>
                      <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', BADGE[state])}>{t(`accounts.quote.state.${state}`)}</span>
                    </span>
                    <span className="block truncate text-base font-medium">
                      {quote.clientName} · {quote.service}
                    </span>
                    <span dir="ltr" className="block text-sm text-muted">
                      {t('accounts.quote.validUntil')}: {quote.validUntil}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span dir="ltr" className="me-2 text-base font-semibold tabular-nums">
                      {formatBook(quote.amountMinor, quote.currency)}
                    </span>
                    <a
                      href={`/agency/quote?id=${encodeURIComponent(quote.id)}&lang=${locale}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('accounts.quotes.open')}
                      title={t('accounts.quotes.open')}
                      className="inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-text"
                    >
                      <FileText aria-hidden className="size-4" />
                    </a>
                    {quote.status === 'OPEN' && (
                      <>
                        <IconButton label={t('accounts.quotes.accept')} onClick={() => decide(quote.id, 'ACCEPT')} disabled={pending} icon={<Check aria-hidden />} />
                        <IconButton label={t('accounts.quotes.decline')} onClick={() => decide(quote.id, 'DECLINE')} disabled={pending} icon={<X aria-hidden />} />
                      </>
                    )}
                    <IconButton label={t('accounts.quotes.archive')} onClick={() => remove(quote.id)} disabled={pending} icon={<Archive aria-hidden />} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="quote-new-title" className={card}>
        <h2 id="quote-new-title" className="text-md font-semibold">
          {t('accounts.quotes.new')}
        </h2>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3 rounded-md bg-surface p-3">
          <div className="col-span-2">
            <Field label={t('accounts.field.client')} error={errors.client}>
              <Select value={client} onChange={(e) => setClient(e.target.value)} options={[{ value: '', label: '—' }, ...book.clients.map((row) => ({ value: row.id, label: row.name }))]} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label={t('accounts.field.service')} error={errors.service}>
              <Input value={service} onChange={(e) => setService(e.target.value)} maxLength={60} />
            </Field>
          </div>
          <Field label={t('accounts.field.amount')} error={errors.amount}>
            <Input dir="ltr" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-end tabular-nums" />
          </Field>
          <Field label={t('accounts.field.currency')}>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value as AccountCurrency)} options={CURRENCIES} />
          </Field>
          <div className="col-span-2">
            <Field label={t('accounts.quotes.field.valid')}>
              <Select value={days} onChange={(e) => setDays(e.target.value)} options={VALID_DAYS.map((value) => ({ value, label: t('accounts.quotes.days', { days: value }) }))} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label={t('accounts.field.note')}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </Field>
          </div>
          <Button type="submit" variant="primary" pending={pending} icon={<Plus aria-hidden />} className="col-span-2 sm:w-fit">
            {t('accounts.quotes.add')}
          </Button>
        </form>
      </section>
    </div>
  );
}
