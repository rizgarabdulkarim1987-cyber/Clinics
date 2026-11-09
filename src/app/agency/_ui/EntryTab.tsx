'use client';

import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { addAccountEntry, archiveAccountEntry, createAccountClient } from '@/app/studio/_actions/accounts';
import { ACCOUNT_CURRENCIES, inPeriod, slugFromName, summarize, type AccountCurrency, type AccountKind } from '@/lib/accounts';
import type { Locale } from '@/lib/locale';
import type { AccountsBook, BookMovement } from '@/server/studio/queries/accounts';
import { describeFailure } from '@/studio/errors';
import { formatDate } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { parseAmountInput } from '@/studio/money-input';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Money, usedCurrencies } from './money';

/** Names people give the work: offered as suggestions, never forced. */
const SERVICES = {
  INCOME: ['Social media', 'Website', 'Accounting system', 'Ad campaign', 'Commission', 'Printing'],
  EXPENSE: ['Freelancer', 'Equipment', 'Subscription', 'Paid ads', 'Printing'],
} as const;

const SERVICES_AR = {
  INCOME: ['سوشيال ميديا', 'موقع إلكتروني', 'نظام محاسبي', 'حملة إعلانية', 'عمولة', 'طباعة'],
  EXPENSE: ['فريلانسر', 'معدات', 'اشتراك', 'إعلانات مدفوعة', 'طباعة'],
} as const;

const RECENT = 30;

function monthName(year: number, month: number, locale: Locale): string {
  const name = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ar-IQ', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
  return `${name} ${year}`;
}

/** The entry tab: add a movement, add a client, this month's totals, and the latest movements. */
export function EntryTab({ book, today }: { book: AccountsBook; today: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const amountBox = useRef<HTMLDivElement>(null);
  const focusAmount = () => amountBox.current?.querySelector('input')?.focus();

  const [kind, setKind] = useState<AccountKind>('INCOME');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<AccountCurrency>('IQD');
  const [clientId, setClientId] = useState('');
  const [service, setService] = useState('');
  const [day, setDay] = useState(today);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [clientName, setClientName] = useState('');
  const [clientSlug, setClientSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [phone, setPhone] = useState('');
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const [cursor, setCursor] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const [removing, setRemoving] = useState<BookMovement | null>(null);

  const suggestions = (locale === 'en' ? SERVICES : SERVICES_AR)[kind];

  const submitEntry = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseAmountInput(amount, currency);
    if (!parsed.ok || parsed.minor <= 0) {
      setErrors({ amount: t('accounts.error.amount') });
      focusAmount();
      return;
    }
    setErrors({});
    start(async () => {
      const result = await addAccountEntry({ kind, amount, currency, clientId: clientId || null, service, note, occurredOn: day });
      if (result.ok) {
        toast.success(t('accounts.add.saved'));
        setAmount('');
        setNote('');
        focusAmount();
        router.refresh();
      } else {
        const failure = describeFailure(t, locale, result.error);
        setErrors({ ...(failure.fields?.amount ? { amount: t('accounts.error.amount') } : {}), ...(failure.fields?.occurredOn ? { occurredOn: t('accounts.error.date') } : {}) });
        toast.error(failure.message);
      }
    });
  };

  const submitClient = (event: FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await createAccountClient({ name: clientName, slug: clientSlug, phone });
      if (result.ok) {
        toast.success(t('accounts.client.saved'));
        setClientId(result.data.id);
        setClientName('');
        setClientSlug('');
        setSlugEdited(false);
        setPhone('');
        setClientErrors({});
        router.refresh();
      } else {
        const failure = describeFailure(t, locale, result.error);
        setClientErrors(failure.fields ?? {});
        toast.error(failure.message);
      }
    });
  };

  const month = inPeriod(book.movements, { kind: 'month', year: cursor.year, month: cursor.month });
  const totals = summarize(month);
  const shift = (by: number) => {
    const index = cursor.year * 12 + (cursor.month - 1) + by;
    setCursor({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submitEntry} className="flex flex-col gap-4 rounded-lg border border-line-strong bg-raised p-4 sm:p-5" aria-labelledby="add-title">
        <h2 id="add-title" className="text-md font-semibold">
          {t('accounts.add.title')}
        </h2>
        <div role="radiogroup" aria-label={t('accounts.kind.label')} className="inline-flex w-full self-start rounded-md border border-line bg-surface p-0.5 sm:w-auto">
          {(['INCOME', 'EXPENSE'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={cx(
                'h-8 flex-1 rounded-sm px-5 text-base font-medium transition-colors duration-150 sm:flex-none',
                kind === value ? 'bg-raised text-text shadow-[0_0_0_1px_var(--s-line-strong)]' : 'text-muted hover:text-text',
                kind === value && (value === 'INCOME' ? 'text-success' : 'text-danger'),
              )}
            >
              {t(value === 'INCOME' ? 'accounts.kind.income' : 'accounts.kind.expense')}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-12">
          <div ref={amountBox} className="col-span-2 lg:col-span-3">
            <Field label={t('accounts.field.amount')} error={errors.amount}>
              <Input dir="ltr" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,500,000" className="text-end text-md font-semibold" />
            </Field>
          </div>
          <Field label={t('accounts.field.currency')} className="lg:col-span-2">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value as AccountCurrency)} options={ACCOUNT_CURRENCIES.map((value) => ({ value, label: t(`accounts.currency.${value}`) }))} />
          </Field>
          <Field label={t('accounts.field.date')} error={errors.occurredOn} className="lg:col-span-2">
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label={t('accounts.field.client')} className="col-span-2 lg:col-span-5">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)} options={[{ value: '', label: t('accounts.noClient') }, ...book.clients.map((client) => ({ value: client.id, label: client.name }))]} />
          </Field>
          <Field label={t('accounts.field.service')} className="col-span-2 lg:col-span-5">
            <Input list="service-suggestions" value={service} onChange={(e) => setService(e.target.value)} placeholder={t('accounts.service.placeholder')} maxLength={60} />
            <datalist id="service-suggestions">
              {suggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label={t('accounts.field.note')} className="col-span-2 lg:col-span-7">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
          </Field>
        </div>
        <div>
          <Button type="submit" variant="primary" size="lg" pending={pending} icon={<Plus aria-hidden />} className="w-full sm:w-auto">
            {t(kind === 'INCOME' ? 'accounts.add.submitIncome' : 'accounts.add.submitExpense')}
          </Button>
        </div>
      </form>

      <form onSubmit={submitClient} className="grid grid-cols-2 items-start gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5 lg:grid-cols-12" aria-label={t('accounts.client.title')}>
        <h2 className="col-span-2 text-md font-semibold lg:col-span-12">{t('accounts.client.title')}</h2>
        <Field label={t('accounts.client.name')} error={clientErrors.name} className="col-span-2 lg:col-span-4">
          <Input
            value={clientName}
            onChange={(e) => {
              setClientName(e.target.value);
              if (!slugEdited) setClientSlug(slugFromName(e.target.value));
            }}
            maxLength={120}
            autoComplete="off"
          />
        </Field>
        <Field label={t('accounts.client.slug')} hint={t('accounts.client.slugHint')} error={clientErrors.slug} className="col-span-2 lg:col-span-4">
          <Input
            dir="ltr"
            value={clientSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setClientSlug(e.target.value);
            }}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label={t('accounts.client.phone')} className="col-span-2 sm:col-span-1 lg:col-span-2">
          <Input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={60} />
        </Field>
        <div className="col-span-2 flex items-end sm:col-span-1 lg:col-span-2 lg:self-end">
          <Button type="submit" pending={pending} disabled={clientName.trim() === ''} icon={<Plus aria-hidden />} className="w-full">
            {t('accounts.client.submit')}
          </Button>
        </div>
      </form>

      <section aria-labelledby="month-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="month-title" className="text-md font-semibold">
            {monthName(cursor.year, cursor.month, locale)}
          </h2>
          <div className="inline-flex items-center rounded-md border border-line-strong bg-raised">
            <IconButton label={t('accounts.month.prev')} onClick={() => shift(-1)} icon={<ChevronLeft aria-hidden className="rtl:-scale-x-100" />} />
            <IconButton label={t('accounts.month.next')} onClick={() => shift(1)} icon={<ChevronRight aria-hidden className="rtl:-scale-x-100" />} />
          </div>
        </div>
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-raised">
          {usedCurrencies(totals).map((code) => (
            <dl key={code} className="grid grid-cols-1 items-center gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[1fr_1fr_1.2fr] sm:px-5">
              <div>
                <dt className="text-sm text-muted">{t('accounts.summary.income')}</dt>
                <dd className="text-xl font-semibold">
                  <Money minor={totals[code].income} currency={code} locale={locale} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t('accounts.summary.expense')}</dt>
                <dd className="text-xl font-semibold">
                  <Money minor={totals[code].expense} currency={code} locale={locale} />
                </dd>
              </div>
              <div className={cx('rounded-md px-3 py-2', totals[code].net < 0 ? 'bg-danger-wash' : 'bg-success-wash')}>
                <dt className="text-sm text-muted">{t('accounts.summary.net')}</dt>
                <dd className="text-xl font-semibold">
                  <Money minor={totals[code].net} currency={code} locale={locale} tone="net" sign />
                </dd>
              </div>
            </dl>
          ))}
        </div>
        {month.length === 0 && <p className="text-sm text-muted">{t('accounts.summary.nothing')}</p>}
      </section>

      <section aria-labelledby="recent-title" className="flex flex-col gap-2">
        <h2 id="recent-title" className="text-md font-semibold">
          {t('accounts.recent.title')}
        </h2>
        {book.movements.length === 0 ? (
          <EmptyState title={t('accounts.recent.empty')} />
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-raised">
            {book.movements.slice(0, RECENT).map((row) => (
              <li key={row.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.service || t(row.kind === 'INCOME' ? 'accounts.kind.income' : 'accounts.kind.expense')}</p>
                  <p className="truncate text-sm text-muted">
                    {row.clientName ?? t('accounts.noClient')} · {formatDate(row.occurredOn, locale)}
                    {row.note ? ` · ${row.note}` : ''}
                  </p>
                </div>
                <Money minor={row.kind === 'INCOME' ? row.amountMinor : -row.amountMinor} currency={row.currency} locale={locale} tone="net" sign className="font-semibold" />
                <IconButton label={t('accounts.archive')} onClick={() => setRemoving(row)} icon={<Trash2 aria-hidden />} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('accounts.archive.title')}
        body={t('accounts.archive.body')}
        confirmLabel={t('accounts.archive')}
        tone="danger"
        onConfirm={async () => {
          if (!removing) return true;
          const result = await archiveAccountEntry({ id: removing.id });
          if (!result.ok) return { message: describeFailure(t, locale, result.error).message };
          toast.success(t('accounts.archived'));
          setRemoving(null);
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}
