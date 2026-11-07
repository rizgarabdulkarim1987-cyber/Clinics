import { D, convert } from '@/server/domain/wholesale/money'
import { InvalidCatalogError, type Unit } from '@/server/domain/wholesale/catalog'
import type { Currency, PartialRates } from '@/server/domain/wholesale/rates'

export type { Unit } from '@/server/domain/wholesale/catalog'

/** What toBase needs of an item (a Prisma Item with its units satisfies it). 1 `unit` = `factorToBase` base units. */
export type ItemWithUnits = {
  baseUnit: Unit
  units: { unit: Unit; factorToBase: { toString(): string } }[]
}

/** The item is not sold in that unit. */
export class MissingUnitError extends Error {
  constructor(public readonly unit: Unit) {
    super(`item has no ${unit} unit`)
    this.name = 'MissingUnitError'
  }
}

/**
 * Quantity in `unit` -> quantity in the item's base unit (exact; fractions allowed). The base unit is always factor 1.
 * Throws MissingUnitError if the item has no such unit.
 */
export function toBase(qty: { toString(): string }, unit: Unit, item: ItemWithUnits): InstanceType<typeof D> {
  const q = new D(qty.toString())
  if (!q.isFinite()) throw new InvalidCatalogError('quantity must be finite')
  const row = item.units.find((u) => u.unit === unit)
  if (!row) {
    if (unit === item.baseUnit) return q
    throw new MissingUnitError(unit)
  }
  return q.times(new D(row.factorToBase.toString()))
}

type Dec = { toString(): string }
export type PriceInput = { official: Dec; mode: 'OFFICIAL' | 'PERCENT' | 'MANUAL'; percent?: Dec; manual?: Dec }

/**
 * The three ways to price a line: the official list price, a percent off it, or a manual price. Always returns the
 * official price, the final price and the discount (official - final), exact and unrounded.
 */
export function priceLine(p: PriceInput): { official: InstanceType<typeof D>; final: InstanceType<typeof D>; discount: InstanceType<typeof D> } {
  const official = new D(p.official.toString())
  if (!official.isFinite() || official.isNegative()) throw new InvalidCatalogError('official price must be zero or more')
  let final: InstanceType<typeof D>
  if (p.mode === 'OFFICIAL') {
    final = official
  } else if (p.mode === 'PERCENT') {
    if (p.percent === undefined) throw new InvalidCatalogError('percent is required')
    const pct = new D(p.percent.toString())
    if (!pct.isFinite() || pct.isNegative() || pct.gt(100)) throw new InvalidCatalogError('percent must be between 0 and 100')
    final = official.times(new D(100).minus(pct)).div(100)
  } else {
    if (p.manual === undefined) throw new InvalidCatalogError('manual price is required')
    final = new D(p.manual.toString())
    if (!final.isFinite() || final.isNegative()) throw new InvalidCatalogError('manual price must be zero or more')
  }
  return { official, final, discount: official.minus(final) }
}

/** An IQD price shown in another currency at the day's rates. Exact, NOT rounded (round for display only). */
export function priceInCurrency(finalIqd: Dec, currency: Currency, r: PartialRates): InstanceType<typeof D> {
  return convert({ amount: new D(finalIqd.toString()), currency: 'IQD' }, currency, r).amount
}
