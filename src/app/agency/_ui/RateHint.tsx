import type { CurrencyTotals } from '@/lib/accounts';
import { useT } from '@/studio/i18n';

/** Without a rate, dinars and dollars stay on their own lines; this asks for the rate when the period has both kinds. */
export function RateHint({ totals, rate }: { totals: CurrencyTotals; rate: number | null }) {
  const t = useT();
  const hasDollars = totals.USD.income !== 0 || totals.USD.expense !== 0;
  if (rate !== null || !hasDollars) return null;
  return <p className="px-4 py-3 text-sm text-muted sm:px-5">{t('accounts.combined.needRate')}</p>;
}
