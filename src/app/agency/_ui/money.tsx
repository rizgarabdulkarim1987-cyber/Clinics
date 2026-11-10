import { ACCOUNT_CURRENCIES, type AccountCurrency, type CurrencyTotals } from '@/lib/accounts';
import type { Locale } from '@/lib/locale';
import { cx } from '@/studio/ui/cx';

/** The currencies a set of totals has any money in (both when it has none, so a screen is never empty). */
export function usedCurrencies(totals: CurrencyTotals): AccountCurrency[] {
  const used = ACCOUNT_CURRENCIES.filter((currency) => totals[currency].income !== 0 || totals[currency].expense !== 0);
  return used.length ? used : [...ACCOUNT_CURRENCIES];
}

/** Latin digits in every language, as on the invoices: `7,778,120 IQD` and `$5,255.49`. */
export function formatBook(minor: number, currency: AccountCurrency): string {
  if (currency === 'IQD') return `${new Intl.NumberFormat('en-US').format(minor)} IQD`;
  return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
}

/** An amount with its currency, always left to right, so a minus or a plus never jumps to the other side in Arabic. */
export function Money({ minor, currency, tone, sign, className }: { minor: number; currency: AccountCurrency; locale?: Locale; tone?: 'net' | 'plain'; sign?: boolean; className?: string }) {
  const text = formatBook(Math.abs(minor), currency);
  const prefix = minor < 0 ? '−' : sign && minor > 0 ? '+' : '';
  return (
    <span
      dir="ltr"
      className={cx('inline-block whitespace-nowrap tabular-nums', tone === 'net' && minor > 0 && 'text-success', tone === 'net' && minor < 0 && 'text-danger', className)}
    >
      {prefix}
      {text}
    </span>
  );
}

/** One money cell per currency that has money, one under the other: dinars and dollars are never added together. */
export function MoneyStack({ totals, pick, locale, tone, sign }: { totals: CurrencyTotals; pick: 'income' | 'expense' | 'net'; locale: Locale; tone?: 'net' | 'plain'; sign?: boolean }) {
  const used = ACCOUNT_CURRENCIES.filter((currency) => totals[currency].income !== 0 || totals[currency].expense !== 0);
  if (!used.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      {used.map((currency) => (
        <Money key={currency} minor={totals[currency][pick]} currency={currency} locale={locale} tone={tone} sign={sign} />
      ))}
    </span>
  );
}
