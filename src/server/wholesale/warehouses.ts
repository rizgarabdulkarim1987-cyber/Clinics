import { randomUUID } from 'node:crypto';
import type Decimal from 'decimal.js';
import type { ScopedTx } from '@/server/data/tenant-db';
import type { Names, Unit } from '@/server/domain/wholesale/catalog';
import { InvalidStockError } from '@/server/domain/wholesale/costing';
import { D } from '@/server/domain/wholesale/money';
import type { WhRole } from '@/server/domain/wholesale/permissions';
import { transferStock } from './stock';

type Db = ScopedTx;

/** Idempotent and race-safe (partial unique index on company and kind): the company's single MAIN and DAMAGE warehouses. */
export async function seedWarehouses(tx: Db, rid: string): Promise<void> {
  for (const [kind, name] of [
    ['MAIN', 'Main'],
    ['DAMAGE', 'Damage'],
  ] as const) {
    // eslint-disable-next-line no-restricted-properties -- the company's own two fixed warehouses: the id bound is the company's
    await tx.$executeRaw`
      INSERT INTO "WhWarehouse" ("id", "restaurantId", "kind", "name")
      VALUES (gen_random_uuid()::text, ${rid}, ${kind}::"WhWarehouseKind", ${name})
      ON CONFLICT ("restaurantId", "kind") WHERE "kind" IN ('MAIN', 'DAMAGE') DO NOTHING`;
  }
}

export async function warehouseOfKind(tx: Db, rid: string, kind: 'MAIN' | 'DAMAGE'): Promise<{ id: string; name: string }> {
  const w = await tx.whWarehouse.findFirst({ where: { restaurantId: rid, kind }, select: { id: true, name: true } });
  if (!w) throw new InvalidStockError(`no ${kind} warehouse for this company`);
  return w;
}

/**
 * Give a rep his one warehouse and put it on his staff row (the composite key only accepts this warehouse for this user).
 * Throws InvalidStockError when the person is not an active rep of the company or already has a warehouse.
 */
export async function createRepWarehouse(tx: Db, rid: string, repUserId: string): Promise<{ id: string; name: string }> {
  const staff = await tx.whStaff.findFirst({
    where: { restaurantId: rid, userId: repUserId, role: 'REP', deactivatedAt: null },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
  if (!staff) throw new InvalidStockError('a rep warehouse needs an active rep of this company');
  if (await tx.whWarehouse.findFirst({ where: { restaurantId: rid, repUserId }, select: { id: true } })) {
    throw new InvalidStockError('this rep already has a warehouse');
  }
  const name = staff.user.name.trim() || staff.user.email;
  const wh = await tx.whWarehouse.create({ data: { restaurantId: rid, kind: 'REP', name, repUserId }, select: { id: true, name: true } });
  await tx.whStaff.update({ where: { id: staff.id }, data: { warehouseId: wh.id } });
  return wh;
}

export function listWarehouses(tx: Db, rid: string, viewer: { role: WhRole; warehouseId: string | null }) {
  return tx.whWarehouse.findMany({
    where: { restaurantId: rid, ...(viewer.role === 'REP' ? { id: viewer.warehouseId ?? '' } : {}) },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    select: { id: true, kind: true, name: true, repUserId: true },
  });
}

/**
 * The transfer form: the main warehouse to one rep's warehouse. It posts no journal entry: both warehouses are the company's
 * own inventory, so the company-wide inventory value does not change; the per-warehouse value lives in the balances.
 */
export async function transferMainToRep(
  tx: Db,
  rid: string,
  userId: string,
  input: { itemId: string; toWarehouseId: string; qtyBase: Decimal | string },
): Promise<{ transferId: string }> {
  const main = await warehouseOfKind(tx, rid, 'MAIN');
  const to = await tx.whWarehouse.findFirst({ where: { id: input.toWarehouseId, restaurantId: rid }, select: { id: true, kind: true } });
  if (!to) throw new InvalidStockError(`unknown warehouse: ${input.toWarehouseId}`);
  if (to.kind !== 'REP') throw new InvalidStockError('transfers from the main warehouse go to a rep warehouse');
  const transferId = randomUUID();
  await transferStock(tx, {
    restaurantId: rid,
    itemId: input.itemId,
    fromWarehouseId: main.id,
    toWarehouseId: to.id,
    qtyBase: new D(input.qtyBase),
    ref: { type: 'TRANSFER', id: transferId },
    user: { id: userId },
  });
  return { transferId };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading stock (the role rules are part of the query)
// ---------------------------------------------------------------------------------------------------------------

export type StockQtyRow = {
  warehouseId: string;
  warehouseKind: 'MAIN' | 'REP' | 'DAMAGE';
  warehouseName: string;
  itemId: string;
  itemCode: string;
  itemNames: Names;
  baseUnit: Unit;
  qtyBase: Decimal;
};
export type StockCostRow = StockQtyRow & { avgCostIqd: Decimal };

const orderBy = [{ warehouse: { kind: 'asc' } }, { warehouse: { name: 'asc' } }, { item: { code: 'asc' } }] as const;

/**
 * Stock list for a viewer. A partner (cost.view): every warehouse with quantity and average cost. A rep: quantities only (the
 * cost column is never selected), for the warehouse whose rep is the viewer and no other: a rep never sees the main warehouse.
 */
export async function stockFor(
  tx: Db,
  rid: string,
  viewer: { role: WhRole; userId: string; canSeeCost: boolean },
): Promise<(StockQtyRow | StockCostRow)[]> {
  const base = {
    itemId: true,
    warehouseId: true,
    qtyBase: true,
    item: { select: { code: true, names: true, baseUnit: true } },
    warehouse: { select: { kind: true, name: true } },
  } as const;
  const shape = (r: {
    warehouseId: string;
    warehouse: { kind: 'MAIN' | 'REP' | 'DAMAGE'; name: string };
    itemId: string;
    item: { code: string; names: unknown; baseUnit: Unit };
    qtyBase: { toString(): string };
  }): StockQtyRow => ({
    warehouseId: r.warehouseId,
    warehouseKind: r.warehouse.kind,
    warehouseName: r.warehouse.name,
    itemId: r.itemId,
    itemCode: r.item.code,
    itemNames: r.item.names as Names,
    baseUnit: r.item.baseUnit,
    qtyBase: new D(r.qtyBase.toString()),
  });
  if (viewer.canSeeCost && viewer.role !== 'REP') {
    const rows = await tx.whStockBalance.findMany({ where: { restaurantId: rid }, select: { ...base, avgCostIqd: true }, orderBy: [...orderBy] });
    return rows.map((r) => ({ ...shape(r), avgCostIqd: new D(r.avgCostIqd.toString()) }));
  }
  const rows = await tx.whStockBalance.findMany({
    where: { restaurantId: rid, warehouse: { kind: 'REP', repUserId: viewer.userId } },
    select: base,
    orderBy: [...orderBy],
  });
  return rows.map(shape);
}
