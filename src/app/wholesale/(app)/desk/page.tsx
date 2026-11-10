import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess } from '@/server/wholesale/access';
import { Pane } from '../../_ui/Hub';
import CustomersPage from '../customers/page';
import HomePage from '../home/page';
import SalesPage from '../sales/page';
import StockPage from '../stock/page';

export const metadata: Metadata = { title: 'Desk' };

/**
 * The whole company on one screen: the numbers on top, then selling, customers, stock and side by side. Each part
 * scrolls inside its own frame, so nothing needs a tab or another page.
 */
export default async function DeskPage() {
  const { actor } = await getWhAccess();
  const can = (p: Parameters<typeof canWh>[1]) => canWh(actor!.role, p);
  const panes: { node: ReactNode; wide?: boolean }[] = [];
  if (can('sale.create')) panes.push({ node: <SalesPage searchParams={Promise.resolve({})} />, wide: true });
  if (can('catalog.view')) panes.push({ node: <CustomersPage /> });
  if (can('stock.view')) panes.push({ node: <StockPage /> });
  return (
    <div className="flex flex-col md:min-h-0 md:flex-1">
      <div className="shrink-0">
        <HomePage />
      </div>
      <div className="grid gap-2 px-4 pb-3 md:min-h-0 md:flex-1 md:grid-cols-2 md:px-6 xl:grid-cols-4">
        {panes.map((p, i) => (
          <Pane key={i} className={p.wide ? 'xl:col-span-2' : ''}>
            {p.node}
          </Pane>
        ))}
      </div>
    </div>
  );
}
