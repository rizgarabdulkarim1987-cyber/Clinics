import Decimal from 'decimal.js'
import { D } from '@/server/domain/wholesale/money'

/**
 * Stock costing rules (pure). Quantities are in the item's BASE unit, `Decimal(24,8)`; costs are IQD per base unit,
 * stored with 8 dp (`avgCostIqd Decimal(24,8)`) so repeated averaging does not drift. All arithmetic uses the shared
 * 40-digit `D`; the only rounding is `roundCost` when an average is stored.
 */

export const QTY_DP = 8
export const COST_DP = 8
/** Decimal(24,8) holds values below 10^16. */
const LIMIT = new D(10).pow(24 - QTY_DP)

type Dec = Decimal | InstanceType<typeof D>

/** Bad stock input (quantity, cost, unknown item/warehouse, missing ref...). Nothing has been written. */
export class InvalidStockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidStockError'
  }
}

/** Issuing `requested` would take the balance below zero. */
export class InsufficientStockError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly warehouseId: string,
    public readonly available: Decimal,
    public readonly requested: Decimal,
  ) {
    super(`insufficient stock of item ${itemId} in warehouse ${warehouseId}: available ${available.toFixed()}, requested ${requested.toFixed()}`)
    this.name = 'InsufficientStockError'
  }
}

/**
 * A landed cost cannot be added to a warehouse that holds none of the item. The caller decides where that cost goes
 * (for example straight to P&L when the goods are already sold).
 */
export class NoStockToRecostError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly warehouseId: string,
  ) {
    super(`no stock of item ${itemId} on hand in warehouse ${warehouseId} to re-cost`)
    this.name = 'NoStockToRecostError'
  }
}

function toD(v: unknown, label: string): InstanceType<typeof D> {
  if (typeof v === 'number' || v === null || v === undefined || typeof (v as { toFixed?: unknown }).toFixed !== 'function')
    throw new InvalidStockError(`${label} must be a Decimal`)
  let d: InstanceType<typeof D>
  try {
    d = new D((v as Dec).toString())
  } catch {
    throw new InvalidStockError(`${label} is not a number`)
  }
  if (!d.isFinite()) throw new InvalidStockError(`${label} must be finite`)
  return d
}

/** A quantity to move: a Decimal (never a JS number), > 0, at most 8 dp (never rounded: quantities are exact). */
export function assertQty(v: unknown, label = 'quantity'): InstanceType<typeof D> {
  const d = toD(v, label)
  if (!d.gt(0)) throw new InvalidStockError(`${label} must be greater than zero`)
  if (d.decimalPlaces() > QTY_DP) throw new InvalidStockError(`${label} has more than ${QTY_DP} decimal places`)
  if (d.gte(LIMIT)) throw new InvalidStockError(`${label} is too large`)
  return d
}

/** A unit cost (IQD per base unit): a Decimal, >= 0, below the column capacity. Rounded half-up to 8 dp. */
export function assertCost(v: unknown, label = 'unit cost'): InstanceType<typeof D> {
  const d = toD(v, label)
  if (d.isNegative() && !d.isZero()) throw new InvalidStockError(`${label} must not be negative`)
  if (d.gte(LIMIT)) throw new InvalidStockError(`${label} is too large`)
  return roundCost(d)
}

/** Storage precision of a unit cost / average: 8 dp, half-up. */
export function roundCost(v: Dec): InstanceType<typeof D> {
  const r = new D(v.toString()).toDecimalPlaces(COST_DP, D.ROUND_HALF_UP)
  return r.isZero() ? new D(0) : r
}

/**
 * Weighted average unit cost after receiving `inQty` at `inCost` into `onHandQty` held at `onHandCost` (both costs
 * per base unit). With nothing on hand the result is the incoming cost. Exact (unrounded).
 */
export function weightedAvg(onHandQty: Dec, onHandCost: Dec, inQty: Dec, inCost: Dec): InstanceType<typeof D> {
  const q0 = toD(onHandQty, 'on-hand quantity')
  const c0 = toD(onHandCost, 'on-hand cost')
  const q1 = toD(inQty, 'incoming quantity')
  const c1 = toD(inCost, 'incoming cost')
  if (q0.isNegative() && !q0.isZero()) throw new InvalidStockError('on-hand quantity must not be negative')
  if (!q1.gt(0)) throw new InvalidStockError('incoming quantity must be greater than zero')
  if ((c0.isNegative() && !c0.isZero()) || (c1.isNegative() && !c1.isZero())) throw new InvalidStockError('cost must not be negative')
  if (q0.isZero()) return c1
  return q0.times(c0).plus(q1.times(c1)).div(q0.plus(q1))
}

/**
 * New average after adding a total cost (landed cost) to the on-hand value: (qty * avg + addedCost) / qty. Exact.
 * Throws NoStockToRecostError when qty is 0 (the itemId/warehouseId are filled in by the caller's error).
 */
export function recostAvg(qty: Dec, avg: Dec, addedCost: Dec, where: { itemId: string; warehouseId: string } = { itemId: '?', warehouseId: '?' }): InstanceType<typeof D> {
  const q = toD(qty, 'on-hand quantity')
  const a = toD(avg, 'average cost')
  const add = toD(addedCost, 'added cost')
  if (!add.gt(0)) throw new InvalidStockError('added cost must be greater than zero')
  if (!q.gt(0)) throw new NoStockToRecostError(where.itemId, where.warehouseId)
  return q.times(a).plus(add).div(q)
}
