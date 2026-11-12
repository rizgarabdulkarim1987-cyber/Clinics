import type { Metadata } from 'next';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess } from '@/server/wholesale/access';
import { Hub } from '../../_ui/Hub';
import ExpensesPage from '../expenses/page';
import RatesPage from '../rates/page';
import TreasuryPage from '../treasury/page';

export const metadata: Metadata = { title: 'Money' };

/** The till, the expenses and the exchange rates on one screen. */
export default async function MoneyPage() {
  const { actor } = await getWhAccess();
  const can = (p: Parameters<typeof canWh>[1]) => canWh(actor!.role, p);
  return <Hub panes={[can('custody.submit') && <TreasuryPage key="t" />, can('expense.submit') && <ExpensesPage key="e" />, can('rate.set') && <RatesPage key="r" />]} />;
}
