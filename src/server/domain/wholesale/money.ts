import Decimal from 'decimal.js'
import { RateMissingError, type Currency, type PartialRates } from '@/server/domain/wholesale/rates'

export type { Currency, DayRates, PartialRates } from '@/server/domain/wholesale/rates'
export type Money = { amount: Decimal; currency: Currency }

/**
 * Own Decimal class so money arithmetic never depends on (or changes) the global precision (20 digits). 40 significant
 * digits, half-up. Use it for every money sum/product (ledger balancing included).
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

function rateOf(r: PartialRates, c: Currency): Decimal {
  if (c === 'IQD') return new D(1) // implicit, never read from the rates
  const v = r.iqdPer[c]
  if (v === undefined || v === null) throw new RateMissingError(r.date, c)
  return new D(v)
}

/** Amount in IQD (exact, unrounded). */
export function toIqd(m: Money, r: PartialRates): Decimal {
  if (m.currency === 'IQD') return m.amount
  return new D(m.amount).times(rateOf(r, m.currency))
}

/**
 * Convert via IQD: amount * iqdPer[from] / iqdPer[to]. Exact to 40 significant digits, NOT rounded
 * (use roundMoney for display, never inside arithmetic). Same currency returns `m` untouched and needs no rates,
 * so an all-IQD document never needs a rate.
 */
export function convert(m: Money, to: Currency, r: PartialRates): Money {
  if (m.currency === to) return m
  const iqd = new D(m.amount).times(rateOf(r, m.currency))
  return { amount: to === 'IQD' ? iqd : iqd.div(rateOf(r, to)), currency: to }
}

/** Display precision (decimal places): IQD 2, USD 2, IRT 0. */
export const DISPLAY_DP: Record<Currency, number> = { IQD: 2, USD: 2, IRT: 0 }

/**
 * Display text for an amount: rounded half-up to `dp` places, thousands grouped with commas, Latin digits, a leading
 * '-' for negatives (never '-0'). Exact decimal arithmetic; display only.
 */
export function formatAmount(v: Decimal.Value, dp = 0): string {
  const d = new D(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP)
  const [int, frac] = d.abs().toFixed(dp).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${d.isNeg() && !d.isZero() ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
}

/** formatAmount with a currency symbol, the sign before the symbol: '-$5', '$1,235' (never '$-5' or '-$0'). */
export function formatSigned(v: Decimal.Value, symbol: string, dp = 0): string {
  const s = formatAmount(v, dp)
  return s.startsWith('-') ? `-${symbol}${s.slice(1)}` : `${symbol}${s}`
}

/** Round to the currency's display precision, ROUND_HALF_UP (halves away from zero). Display/output only. */
export function roundMoney(m: Money): Money {
  return { amount: m.amount.toDecimalPlaces(DISPLAY_DP[m.currency], Decimal.ROUND_HALF_UP), currency: m.currency }
}
