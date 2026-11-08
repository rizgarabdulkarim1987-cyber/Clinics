import Decimal from 'decimal.js'

/** Currencies. IQD is the report base. IRT = Iranian Toman. */
export const CURRENCIES = ['IQD', 'USD', 'IRT'] as const
export type Currency = (typeof CURRENCIES)[number]

/** Currencies that need a stored daily rate. IQD is implicit (always 1) and is never stored. */
export const RATED_CURRENCIES = ['USD', 'IRT'] as const satisfies readonly Currency[]
export type RatedCurrency = (typeof RATED_CURRENCIES)[number]

/**
 * Rates for one calendar day. `date` is 'YYYY-MM-DD' on the Asia/Baghdad calendar.
 * `iqdPer[c]` = IQD per 1 unit of c; IQD is always 1. DayRates holds every currency (see getRates).
 */
export type DayRates = { date: string; iqdPer: Record<Currency, Decimal> }

/**
 * Rates for only the currencies a document involves (see requireRates): unrequested keys are ABSENT, so the object
 * is plain data (spread, JSON, structuredClone, toEqual all work). convert/toIqd throw RateMissingError for a
 * currency whose key is absent. Every DayRates is a PartialRates.
 */
export type PartialRates = { date: string; iqdPer: Partial<Record<Currency, Decimal>> }

/** No rate stored for exactly this date and currency. There is never a fallback to another day. */
export class RateMissingError extends Error {
  constructor(
    public readonly date: string,
    public readonly currency: Currency,
  ) {
    super(`exchange rate missing: ${currency} on ${date}`)
    this.name = 'RateMissingError'
  }
}

/** A rate or date that cannot be stored. */
export class InvalidRateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRateError'
  }
}

/** Rates are stored as Decimal(18,8): at most 10 integer digits, 8 decimals. */
export const RATE_DP = 8
const RATE_MAX = new Decimal('10000000000')

/** True for a real calendar date written exactly as YYYY-MM-DD. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Today's calendar date in Asia/Baghdad as 'YYYY-MM-DD'. */
export function baghdadDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/**
 * Validate an entered rate: a finite number > 0 below 1e10, given as Decimal or string (never a JS number).
 * Returns it rounded to 8 dp (ROUND_HALF_UP, the stored precision); a rate that rounds to 0 is rejected.
 */
export function parseRate(v: Decimal.Value): Decimal {
  if (typeof v === 'number') throw new InvalidRateError('rate must be a string or Decimal, not a number')
  let d: Decimal
  try {
    d = new Decimal(v)
  } catch {
    throw new InvalidRateError('rate is not a number')
  }
  if (!d.isFinite()) throw new InvalidRateError('rate must be finite')
  if (!d.gt(0)) throw new InvalidRateError('rate must be greater than zero')
  if (d.gte(RATE_MAX)) throw new InvalidRateError('rate is too large')
  const r = d.toDecimalPlaces(RATE_DP, Decimal.ROUND_HALF_UP)
  if (!r.gt(0)) throw new InvalidRateError('rate is too small')
  return r
}

/** Cross rate: how many `b` units equal one `a` unit (e.g. IRT per 1 USD). Both rates must be IQD-per-unit. */
export function crossRate(a: Decimal, b: Decimal): Decimal {
  return new Decimal(a).div(b)
}
