import { combineTotals, type CurrencyTotals } from '@/lib/accounts';
import type { Locale } from '@/lib/locale';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { Money } from './money';

/**
 * Income, expense and profit with the dollars added to the dinars at the exchange rate, in dinars. It shows only when
 * the period holds dollars (with dinars alone, the line above already says it) and asks for the rate when there is none.
 */
export function CombinedRow({ totals, rate, locale }: { totals: CurrencyTotals; rate: number | null; locale: Locale }) {
  const t = useT();
  const hasDollars = totals.USD.income !== 0 || totals.USD.expense !== 0;
  if (!hasDollars) return null;
  if (rate === null) return <p className="px-4 py-3 text-sm text-muted sm:px-5">{t('accounts.combined.needRate')}</p>;
  const combined = combineTotals(totals, rate);
  return (
    <dl className="grid grid-cols-1 items-center gap-x-6 gap-y-3 bg-surface px-4 py-4 sm:grid-cols-[1fr_1fr_1.2fr] sm:px-5" aria-label={t('accounts.combined')}>
      <div>
        <dt className="text-sm text-muted">{t('accounts.combined')}</dt>
        <dd className="text-xl font-semibold">
          <Money minor={combined.income} currency="IQD" locale={locale} />
        </dd>
      </div>
      <div>
        <dt className="text-sm text-muted">{t('accounts.summary.expense')}</dt>
        <dd className="text-xl font-semibold">
          <Money minor={combined.expense} currency="IQD" locale={locale} />
        </dd>
      </div>
      <div className={cx('rounded-md px-3 py-2', combined.net < 0 ? 'bg-danger-wash' : 'bg-success-wash')}>
        <dt className="text-sm text-muted">{t('accounts.summary.net')}</dt>
        <dd className="text-xl font-semibold">
          <Money minor={combined.net} currency="IQD" locale={locale} tone="net" sign />
        </dd>
      </div>
    </dl>
  );
}
