'use client';

import type { ReactNode } from 'react';
import type { CurrencyTotals } from '@/lib/accounts';
import { useLocale, useT } from '@/studio/i18n';
import { Money, usedCurrencies } from './money';

/**
 * A period's money, one row per currency line: what was kept first and largest (it is the answer to "how are we doing"),
 * then what came in and what went out. Colour only on the kept amount, so a screen of numbers stays calm.
 */
export function TotalsCard({ totals, footer }: { totals: CurrencyTotals; footer?: ReactNode }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-raised">
      {usedCurrencies(totals).map((code) => (
        <dl key={code} className="grid grid-cols-2 items-end gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[1.5fr_1fr_1fr] sm:px-5">
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-sm text-muted">{t('accounts.summary.net')}</dt>
            <dd className="text-2xl font-semibold">
              <Money minor={totals[code].net} currency={code} locale={locale} tone="net" sign />
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t('accounts.summary.income')}</dt>
            <dd className="text-lg font-medium">
              <Money minor={totals[code].income} currency={code} locale={locale} />
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t('accounts.summary.expense')}</dt>
            <dd className="text-lg font-medium">
              <Money minor={totals[code].expense} currency={code} locale={locale} />
            </dd>
          </div>
        </dl>
      ))}
      {footer}
    </div>
  );
}
