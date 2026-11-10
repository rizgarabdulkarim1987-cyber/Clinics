'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { addAccountRecurring, archiveAccountRecurring, removeAccountBudget, setAccountBudget } from '@/app/studio/_actions/accounts';
import type { AccountCurrency } from '@/lib/accounts';
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

/** What an expense is usually for: offered as suggestions in the service box, never forced. */
const EXPENSE_SERVICES = ['Rent', 'Electricity', 'Freelancer', 'Equipment', 'Subscription', 'Paid ads', 'Printing', 'Salary', 'Hosting', 'Other'];
const DAYS = Array.from({ length: 28 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }));
const CURRENCIES = [
  { value: 'IQD', label: 'IQD' },
  { value: 'USD', label: 'USD' },
];

/**
 * The plan tab: what repeats every month (rent, subscriptions, salaries: posted by themselves on their day) and the
 * monthly ceiling for each kind of expense, with how much of it this month has used.
 */
export function PlanTab({ book, today }: { book: AccountsBook; today: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const monthKey = today.slice(0, 7);
  const monthName = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ar-IQ', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${monthKey}-01T00:00:00Z`));

  const [rService, setRService] = useState('');
  const [rAmount, setRAmount] = useState('');
  const [rCurrency, setRCurrency] = useState<AccountCurrency>('IQD');
  const [rDay, setRDay] = useState('1');
  const [rNote, setRNote] = useState('');
  const [rErrors, setRErrors] = useState<{ service?: string; amount?: string }>({});

  const [bService, setBService] = useState('');
  const [bAmount, setBAmount] = useState('');
  const [bCurrency, setBCurrency] = useState<AccountCurrency>('IQD');
  const [bErrors, setBErrors] = useState<{ service?: string; amount?: string }>({});

  const spentThisMonth = (service: string, currency: AccountCurrency) =>
    book.movements.filter((row) => row.kind === 'EXPENSE' && row.currency === currency && row.service === service && row.occurredOn.startsWith(monthKey)).reduce((sum, row) => sum + row.amountMinor, 0);

  const check = (service: string, amount: string, currency: AccountCurrency, set: (errors: { service?: string; amount?: string }) => void) => {
    const parsed = parseAmountInput(amount, currency);
    const errors = { ...(service.trim() === '' ? { service: t('accounts.plan.error.service') } : {}), ...(!parsed.ok || parsed.minor <= 0 ? { amount: t('accounts.error.amount') } : {}) };
    set(errors);
    return Object.keys(errors).length === 0;
  };

  const submitRecurring = (event: FormEvent) => {
    event.preventDefault();
    if (!check(rService, rAmount, rCurrency, setRErrors)) return;
    start(async () => {
      const result = await addAccountRecurring({ service: rService, note: rNote, amount: rAmount, currency: rCurrency, dayOfMonth: Number(rDay) });
      if (result.ok) {
        toast.success(t('accounts.plan.recurring.added'));
        setRService('');
        setRAmount('');
        setRNote('');
        router.refresh();
      } else toast.error(describeFailure(t, locale, result.error).message);
    });
  };

  const stopRecurring = (id: string) =>
    start(async () => {
      const result = await archiveAccountRecurring({ id });
      if (result.ok) {
        toast.success(t('accounts.plan.recurring.stopped'));
        router.refresh();
      } else toast.error(describeFailure(t, locale, result.error).message);
    });

  const submitBudget = (event: FormEvent) => {
    event.preventDefault();
    if (!check(bService, bAmount, bCurrency, setBErrors)) return;
    start(async () => {
      const result = await setAccountBudget({ service: bService, amount: bAmount, currency: bCurrency });
      if (result.ok) {
        toast.success(t('accounts.plan.budget.saved'));
        setBService('');
        setBAmount('');
        router.refresh();
      } else toast.error(describeFailure(t, locale, result.error).message);
    });
  };

  const dropBudget = (id: string) =>
    start(async () => {
      const result = await removeAccountBudget({ id });
      if (result.ok) {
        toast.success(t('accounts.plan.budget.removed'));
        router.refresh();
      } else toast.error(describeFailure(t, locale, result.error).message);
    });

  const card = 'flex flex-col gap-4 rounded-lg border border-line bg-raised p-5 lg:max-h-full lg:min-h-0 lg:self-start lg:overflow-y-auto';

  return (
    <div className="flex flex-col gap-4 lg:grid lg:h-full lg:grid-cols-2 lg:gap-5">
      <datalist id="plan-services">
        {EXPENSE_SERVICES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <section aria-labelledby="recurring-title" className={card}>
        <div>
          <h2 id="recurring-title" className="text-md font-semibold">
            {t('accounts.plan.recurring.title')}
          </h2>
          <p className="text-sm text-muted">{t('accounts.plan.recurring.hint')}</p>
        </div>

        {book.recurring.length === 0 ? (
          <p className="rounded-md bg-surface px-4 py-3 text-sm text-muted">{t('accounts.plan.recurring.empty')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {book.recurring.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-base font-medium">{item.service}</span>
                  <span className="block truncate text-sm text-muted">{item.note ? `${t('accounts.plan.recurring.day', { day: String(item.dayOfMonth) })} · ${item.note}` : t('accounts.plan.recurring.day', { day: String(item.dayOfMonth) })}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span dir="ltr" className="text-base font-semibold tabular-nums">
                    {formatBook(item.amountMinor, item.currency)}
                  </span>
                  <IconButton label={t('accounts.plan.recurring.stop')} onClick={() => stopRecurring(item.id)} disabled={pending} icon={<Trash2 aria-hidden />} />
                </span>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submitRecurring} className="grid grid-cols-2 gap-3 rounded-md bg-surface p-3">
          <Field label={t('accounts.field.service')} error={rErrors.service}>
            <Input list="plan-services" value={rService} onChange={(e) => setRService(e.target.value)} maxLength={60} />
          </Field>
          <Field label={t('accounts.field.amount')} error={rErrors.amount}>
            <Input dir="ltr" inputMode="decimal" autoComplete="off" value={rAmount} onChange={(e) => setRAmount(e.target.value)} className="text-end tabular-nums" />
          </Field>
          <Field label={t('accounts.field.currency')}>
            <Select value={rCurrency} onChange={(e) => setRCurrency(e.target.value as AccountCurrency)} options={CURRENCIES} />
          </Field>
          <Field label={t('accounts.plan.recurring.field.day')}>
            <Select value={rDay} onChange={(e) => setRDay(e.target.value)} options={DAYS} />
          </Field>
          <div className="col-span-2">
            <Field label={t('accounts.field.note')}>
              <Input value={rNote} onChange={(e) => setRNote(e.target.value)} maxLength={120} />
            </Field>
          </div>
          <Button type="submit" variant="primary" pending={pending} icon={<Plus aria-hidden />} className="col-span-2 sm:w-fit">
            {t('accounts.plan.recurring.add')}
          </Button>
        </form>
      </section>

      <section aria-labelledby="budget-title" className={card}>
        <div>
          <h2 id="budget-title" className="text-md font-semibold">
            {t('accounts.plan.budget.title', { month: monthName })}
          </h2>
          <p className="text-sm text-muted">{t('accounts.plan.budget.hint')}</p>
        </div>

        {book.budgets.length === 0 ? (
          <p className="rounded-md bg-surface px-4 py-3 text-sm text-muted">{t('accounts.plan.budget.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {book.budgets.map((budget) => {
              const spent = spentThisMonth(budget.service, budget.currency);
              const over = spent > budget.limitMinor;
              const share = Math.min(100, Math.round((spent / budget.limitMinor) * 100));
              return (
                <li key={budget.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-base font-medium">{budget.service}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span dir="ltr" className={cx('text-sm tabular-nums', over ? 'font-semibold text-danger' : 'text-muted')}>
                        {formatBook(spent, budget.currency)} / {formatBook(budget.limitMinor, budget.currency)}
                      </span>
                      <IconButton label={t('accounts.plan.budget.remove')} onClick={() => dropBudget(budget.id)} disabled={pending} icon={<Trash2 aria-hidden />} />
                    </span>
                  </div>
                  <div role="img" aria-label={`${share}%`} className="h-2.5 rounded-full bg-line" dir="ltr">
                    <div className={cx('h-full rounded-full', over ? 'bg-danger' : share >= 80 ? 'bg-accent' : 'bg-ink')} style={{ width: `${Math.max(share > 0 ? 3 : 0, share)}%` }} />
                  </div>
                  {over && <span className="text-sm font-medium text-danger">{t('accounts.plan.budget.over', { amount: formatBook(spent - budget.limitMinor, budget.currency) })}</span>}
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={submitBudget} className="grid grid-cols-2 gap-3 rounded-md bg-surface p-3">
          <div className="col-span-2">
            <Field label={t('accounts.field.service')} error={bErrors.service}>
              <Input list="plan-services" value={bService} onChange={(e) => setBService(e.target.value)} maxLength={60} />
            </Field>
          </div>
          <Field label={t('accounts.plan.budget.limit')} error={bErrors.amount}>
            <Input dir="ltr" inputMode="decimal" autoComplete="off" value={bAmount} onChange={(e) => setBAmount(e.target.value)} className="text-end tabular-nums" />
          </Field>
          <Field label={t('accounts.field.currency')}>
            <Select value={bCurrency} onChange={(e) => setBCurrency(e.target.value as AccountCurrency)} options={CURRENCIES} />
          </Field>
          <Button type="submit" variant="primary" pending={pending} icon={<Plus aria-hidden />} className="col-span-2 sm:w-fit">
            {t('accounts.plan.budget.save')}
          </Button>
        </form>
      </section>
    </div>
  );
}
