import type { Metadata } from 'next';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { expensesQuery } from '@/server/wholesale/queries/treasury';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, StatusBadge } from '@/studio/ui';
import { PageHeader } from '../../_ui/PageHeader';
import { ExpenseDecision, ExpenseForm } from '../../_ui/TreasuryForms';

export const metadata: Metadata = { title: 'Expenses' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

export default async function ExpensesPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const isRep = actor!.role === 'REP';
  const approver = canWh(actor!.role, 'expense.manage');
  const expenses = await queryWh(expensesQuery);
  const pending = approver ? expenses.filter((e) => e.status === 'PENDING') : [];
  return (
    <>
      <PageHeader title={t('wh.expenses.title')} description={isRep ? t('wh.expenses.descriptionRep') : t('wh.expenses.description')} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        {pending.length > 0 && (
          <section className="flex flex-col gap-3 rounded-md border border-line bg-raised p-4">
            <h2 className="text-md font-semibold">{t('wh.sales.pending')}</h2>
            {pending.map((e) => (
              <div key={e.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
                <p className="text-base" dir="auto">
                  #{e.number} · {t(`wh.expenses.cat.${e.category}`)} ·{' '}
                  <span dir="ltr">
                    {money(e.amount)} {e.currency}
                  </span>
                  {e.note ? ` · ${e.note}` : ''}
                </p>
                <ExpenseDecision expenseId={e.id} />
              </div>
            ))}
          </section>
        )}
        <details className="rounded-md border border-line bg-raised">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.expenses.new')}</summary>
          <div className="border-t border-line p-4">
            <ExpenseForm today={baghdadDate()} isRep={isRep} />
          </div>
        </details>
        {expenses.length === 0 ? (
          <EmptyState title={t('wh.expenses.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {expenses.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-line bg-raised p-4">
                <span>
                  <span className="text-base font-semibold" dir="auto">
                    #{e.number} · {t(`wh.expenses.cat.${e.category}`)}
                  </span>
                  <span className="block text-sm text-muted" dir="auto">
                    {e.date}
                    {e.note ? ` · ${e.note}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  {e.status !== 'POSTED' && <StatusBadge tone="neutral">{t(`wh.sales.status.${e.status === 'PENDING' ? 'PENDING_APPROVAL' : e.status}`)}</StatusBadge>}
                  <span className="text-base font-semibold tabular-nums" dir="ltr">
                    {money(e.amount)} {e.currency}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
