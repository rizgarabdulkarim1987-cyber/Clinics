import { randomUUID } from 'node:crypto';
import type { ScopedTx } from '@/server/data/tenant-db';
import { roundCost } from '@/server/domain/wholesale/costing';
import { InvalidCatalogError, parseDecimal } from '@/server/domain/wholesale/catalog';
import { D } from '@/server/domain/wholesale/money';
import { round4 } from '@/server/domain/wholesale/purchase';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { postJournal } from '@/server/wholesale/ledger';
import { lockStockRows, receiveStock } from '@/server/wholesale/stock';
import { warehouseOfKind } from '@/server/wholesale/warehouses';
import type { WhRole } from '@/server/domain/wholesale/permissions';

type Db = ScopedTx;

/** The cost of the opening stock when none is typed: this share of the selling price (the company's rule: price minus 25%). */
const DEFAULT_COST_SHARE = new D('0.75');

/**
 * Puts an opening quantity of one item into the MAIN warehouse the way the opening import does: received through the stock engine at
 * a cost, DR INVENTORY / CR PARTNER_CAPITAL. `qtyBase` is in the item's smallest unit. Without `unitCostIqd` the cost is 75% of the
 * item's selling price per smallest unit (needs a price). For an item added after the once-only STOCK import.
 */
export async function openItemStock(
  tx: Db,
  rid: string,
  user: { id: string; role: WhRole },
  input: { itemId: string; qtyBase: string; unitCostIqd?: string | null },
): Promise<{ qtyBase: string; unitCostIqd: string }> {
  const item = await tx.whItem.findFirst({
    where: { id: input.itemId, restaurantId: rid },
    include: { units: { select: { unit: true, factorToBase: true } }, prices: { select: { unit: true, priceIqd: true } } },
  });
  if (!item) throw new InvalidCatalogError('item not found');
  if (!item.active) throw new InvalidCatalogError('item is archived');
  const qty = parseDecimal(input.qtyBase, { dp: 8, label: 'opening quantity', positive: true });
  const typed = (input.unitCostIqd ?? '').trim();
  let cost: InstanceType<typeof D>;
  if (typed !== '') cost = parseDecimal(typed, { dp: 4, label: 'unit cost' });
  else {
    const priced = item.prices.map((p) => ({ price: new D(p.priceIqd.toFixed()), factor: new D(item.units.find((u) => u.unit === p.unit)?.factorToBase.toFixed() ?? '0') })).find((p) => p.factor.gt(0));
    if (!priced) throw new InvalidCatalogError('give a unit cost or a selling price for the opening stock');
    cost = roundCost(priced.price.div(priced.factor).times(DEFAULT_COST_SHARE));
  }
  const main = await warehouseOfKind(tx, rid, 'MAIN');
  await lockStockRows(tx, rid, [{ itemId: item.id, warehouseId: main.id }]);
  const ref = { type: 'OPENING_ITEM', id: randomUUID() };
  const received = await receiveStock(tx, { restaurantId: rid, itemId: item.id, warehouseId: main.id, qtyBase: qty, unitCostIqd: cost, ref, user });
  const value = round4(qty.times(new D(received.unitCostIqd)));
  if (value.gt(0)) {
    await postJournal(tx, rid, {
      date: baghdadDate(),
      memo: `Opening stock (${item.code})`,
      source: ref,
      user,
      lines: [
        { accountCode: 'INVENTORY', side: 'DR', amount: value, currency: 'IQD' },
        { accountCode: 'PARTNER_CAPITAL', side: 'CR', amount: value, currency: 'IQD' },
      ],
    });
  }
  return { qtyBase: qty.toFixed(), unitCostIqd: new D(received.unitCostIqd).toFixed() };
}
