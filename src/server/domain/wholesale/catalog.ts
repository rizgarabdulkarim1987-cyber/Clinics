import { D } from '@/server/domain/wholesale/money'
import type { Locale } from '@/lib/locale'

/** Units an item can be sold/stocked in. */
export const UNITS = ['PIECE', 'KG', 'TON', 'CARTON', 'SACK_5', 'SACK_10', 'SACK_15', 'SACK_25'] as const
export type Unit = (typeof UNITS)[number]
export const isUnit = (v: unknown): v is Unit => typeof v === 'string' && (UNITS as readonly string[]).includes(v)

/** Item names in the three UI languages. At least one must be non-empty. */
export type Names = { ckb: string; ar: string; en: string }

/** Something the user entered cannot be stored (bad name, number, unit, duplicate code, unknown city...). */
export class InvalidCatalogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCatalogError'
  }
}

/**
 * The item already has stock (a balance, movement or batch), so its base unit, its unit factors and its unit list
 * (removals) are frozen: changing them would silently re-scale every stored quantity. Other fields stay editable.
 */
export class ItemLockedError extends Error {
  constructor(
    public readonly itemId: string,
    reason: string,
  ) {
    super(`item ${itemId} has stock: ${reason}`)
    this.name = 'ItemLockedError'
  }
}

/** Trim all three names; at least one must remain non-empty. */
export function validateNames(n: Partial<Record<keyof Names, unknown>>): Names {
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const names: Names = { ckb: clean(n.ckb), ar: clean(n.ar), en: clean(n.en) }
  if (!names.ckb && !names.ar && !names.en) throw new InvalidCatalogError('at least one name is required')
  return names
}

/** Name to show: the viewer's language first, then ckb -> ar -> en. */
export function displayName(names: Names, locale: Locale = 'ckb'): string {
  for (const l of [locale, 'ckb', 'ar', 'en'] as const) if (names[l]?.trim()) return names[l]
  return ''
}

/** Required, trimmed, non-empty text. */
export function requireText(v: unknown, label: string): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) throw new InvalidCatalogError(`${label} is required`)
  return s
}

/** Optional text: blank/missing becomes null. */
export function optionalText(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

/**
 * Parse an entered decimal (string or Decimal, never a JS number): finite, not negative, below the column's capacity
 * (Decimal(24, dp) -> at most 24 - dp integer digits), rounded half-up to `dp` places. `positive` also rejects zero
 * (checked after rounding).
 */
export function parseDecimal(v: unknown, o: { dp: number; label: string; positive?: boolean }): InstanceType<typeof D> {
  if (typeof v === 'number') throw new InvalidCatalogError(`${o.label} must be a string or Decimal, not a number`)
  if (typeof v !== 'string' && !(v instanceof D) && !(typeof v === 'object' && v !== null && 'toFixed' in v))
    throw new InvalidCatalogError(`${o.label} is not a number`)
  let d: InstanceType<typeof D>
  try {
    d = new D(typeof v === 'string' ? v.trim() : String(v))
  } catch {
    throw new InvalidCatalogError(`${o.label} is not a number`)
  }
  if (!d.isFinite()) throw new InvalidCatalogError(`${o.label} must be finite`)
  if (d.isNegative() && !d.isZero()) throw new InvalidCatalogError(`${o.label} must not be negative`)
  if (d.gte(new D(10).pow(24 - o.dp))) throw new InvalidCatalogError(`${o.label} is too large`)
  const r = d.toDecimalPlaces(o.dp, D.ROUND_HALF_UP)
  if (o.positive && !r.gt(0)) throw new InvalidCatalogError(`${o.label} must be greater than zero`)
  return r.isZero() ? new D(0) : r
}
