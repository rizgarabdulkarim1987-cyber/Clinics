import type { Metadata } from 'next';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess } from '@/server/wholesale/access';
import { Pane } from '../../_ui/Hub';
import CustomersPage from '../customers/page';
import SalesPage from '../sales/page';

export const metadata: Metadata = { title: 'Sales' };

/** Selling and the customer list on one screen: the invoice takes the room, the customers sit beside it. */
export default async function SellPage({ searchParams }: { searchParams: Promise<{ c?: string; s?: string }> }) {
  const { actor } = await getWhAccess();
  const can = (p: Parameters<typeof canWh>[1]) => canWh(actor!.role, p);
  const showCustomers = can('catalog.view');
  return (
    <div className={`grid gap-3 px-4 pb-4 pt-3 md:min-h-0 md:flex-1 md:px-6 ${showCustomers ? 'xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]' : ''}`}>
      {can('sale.create') && (
        <Pane>
          <SalesPage searchParams={searchParams} />
        </Pane>
      )}
      {showCustomers && (
        <Pane>
          <CustomersPage />
        </Pane>
      )}
    </div>
  );
}
