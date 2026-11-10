import type { Metadata } from 'next';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess } from '@/server/wholesale/access';
import { Hub } from '../../_ui/Hub';
import PurchasesPage from '../purchases/page';
import StockPage from '../stock/page';

export const metadata: Metadata = { title: 'Stock and purchases' };

/** Items with their stock, and the purchases that fill it, on one screen. */
export default async function InventoryPage() {
  const { actor } = await getWhAccess();
  const can = (p: Parameters<typeof canWh>[1]) => canWh(actor!.role, p);
  return <Hub panes={[can('stock.view') && <StockPage key="s" />, can('purchase.manage') && <PurchasesPage key="p" />]} />;
}
