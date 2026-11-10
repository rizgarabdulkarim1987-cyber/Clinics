'use client';

import { FileText } from 'lucide-react';
import { useState } from 'react';
import { hasInvoiceActivity, periodKey, type Period } from '@/lib/accounts';
import type { AccountsBook } from '@/server/studio/queries/accounts';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Field } from '@/studio/ui/Field';
import { Select } from '@/studio/ui/Select';

const monthNames = (locale: string) =>
  Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ar-IQ', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1))));

/**
 * The invoice button of the header: pick a client and a period, and the invoice opens in a new tab ready to print or
 * save as PDF. Only clients with an income are offered, and a period with nothing to invoice is refused here, in the
 * person's language, instead of opening an empty page.
 */
export function InvoiceButton({ book, today }: { book: AccountsBook; today: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const thisYear = Number(today.slice(0, 4));
  const [clientId, setClientId] = useState('');
  const [kind, setKind] = useState<Period['kind']>('month');
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(Number(today.slice(5, 7)));

  const withIncome = new Set(book.movements.filter((row) => row.kind === 'INCOME' && row.clientId).map((row) => row.clientId));
  const clients = book.clients.filter((client) => withIncome.has(client.id));
  const years = [...new Set([thisYear, ...book.movements.map((row) => Number(row.occurredOn.slice(0, 4)))])].sort((a, b) => b - a);
  const names = monthNames(locale);

  return (
    <>
      <Button type="button" variant="secondary" size="sm" icon={<FileText aria-hidden />} onClick={() => setOpen(true)} disabled={clients.length === 0} title={clients.length === 0 ? t('accounts.invoice.noClients') : undefined}>
        {t('accounts.invoice')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('accounts.invoice.make')}
        body={t('accounts.invoice.pick')}
        confirmLabel={t('accounts.invoice.create')}
        tone="primary"
        onConfirm={async () => {
          const chosen = clientId || clients[0]?.id;
          if (!chosen) return { fields: { client: t('accounts.invoice.noClients') } };
          const period: Period = kind === 'all' ? { kind: 'all' } : kind === 'year' ? { kind: 'year', year } : { kind: 'month', year, month };
          if (!hasInvoiceActivity(book.movements, chosen, period)) return { fields: { client: t('accounts.invoice.empty') } };
          window.open(`/agency/invoice?client=${encodeURIComponent(chosen)}&period=${encodeURIComponent(periodKey(period))}`, '_blank', 'noopener');
          return true;
        }}
      >
        {(fieldErrors) => (
          <div className="flex flex-col gap-3">
            <Field label={t('accounts.field.client')} error={fieldErrors.client}>
              <Select name="client" value={clientId || clients[0]?.id || ''} onChange={(e) => setClientId(e.target.value)} options={clients.map((client) => ({ value: client.id, label: client.name }))} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('accounts.period.label')}>
                <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as Period['kind'])} options={[{ value: 'month', label: t('accounts.period.kind.month') }, { value: 'year', label: t('accounts.period.kind.year') }, { value: 'all', label: t('accounts.period.kind.all') }]} />
              </Field>
              {kind !== 'all' && (
                <Field label={t('accounts.period.year')}>
                  <Select name="year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={years.map((value) => ({ value: String(value), label: String(value) }))} />
                </Field>
              )}
              {kind === 'month' && (
                <Field label={t('accounts.period.monthLabel')}>
                  <Select name="month" value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} options={names.map((label, index) => ({ value: String(index + 1), label }))} />
                </Field>
              )}
            </div>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
