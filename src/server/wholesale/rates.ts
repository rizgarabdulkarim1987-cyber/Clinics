import Decimal from 'decimal.js'
import type { ScopedTx } from '@/server/data/tenant-db'
import {
  InvalidRateError,
  RateMissingError,
  RATED_CURRENCIES,
  isIsoDate,
  parseRate,
  type Currency,
  type DayRates,
  type PartialRates,
  type RatedCurrency,
} from '@/server/domain/wholesale/rates'

/** Dates are 'YYYY-MM-DD' strings in code and a Postgres DATE column (UTC midnight in Prisma) in the DB. */
const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`)

function assertDate(date: string): void {
  if (!isIsoDate(date)) throw new InvalidRateError(`invalid date: ${String(date)}`)
}

/**
 * Rates for exactly `date`, but only for the currencies the caller actually involves. IQD is always 1 and needs no
 * row, so an all-IQD document needs no rate. A required currency with no row for that exact date throws
 * RateMissingError (no fallback to another day). Unrequested currencies are absent from the result.
 */
export async function requireRates(tx: ScopedTx, date: string, currencies: Currency[]): Promise<PartialRates> {
  assertDate(date)
  const needed = RATED_CURRENCIES.filter((c) => currencies.includes(c))
  const rows = needed.length
    ? await tx.whExchangeRate.findMany({ where: { date: toDbDate(date), currency: { in: needed } } })
    : []
  const iqdPer: Partial<Record<Currency, Decimal>> = { IQD: new Decimal(1) }
  for (const c of needed) {
    const row = rows.find((r) => r.currency === c)
    if (!row) throw new RateMissingError(date, c)
    iqdPer[c] = new Decimal(row.iqdPer.toString())
  }
  return { date, iqdPer }
}

/** Both USD and IRT rates for the exact date, else RateMissingError. */
export async function getRates(tx: ScopedTx, date: string): Promise<DayRates> {
  // requireRates throws unless USD and IRT are both present, so the cast is safe.
  return (await requireRates(tx, date, [...RATED_CURRENCIES])) as DayRates
}

/** Set (upsert) the day's rate for USD or IRT. Needs `rate:set`; audited in the same transaction. */
export async function setRate(
  tx: ScopedTx,
  rid: string,
  date: string,
  currency: Currency,
  iqdPer: Decimal.Value,
): Promise<void> {
  assertDate(date)
  if (currency === 'IQD') throw new InvalidRateError('IQD rate is implicit (always 1) and cannot be stored')
  if (!(RATED_CURRENCIES as readonly string[]).includes(currency)) throw new InvalidRateError(`unknown currency: ${String(currency)}`)
  const rate = parseRate(iqdPer)
  const where = { restaurantId_date_currency: { restaurantId: rid, date: toDbDate(date), currency: currency as RatedCurrency } }
  await tx.whExchangeRate.upsert({
    where,
    create: { restaurantId: rid, date: toDbDate(date), currency, iqdPer: rate.toFixed() },
    update: { iqdPer: rate.toFixed() },
  })
}
