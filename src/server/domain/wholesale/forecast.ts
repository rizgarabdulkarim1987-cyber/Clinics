import type Decimal from 'decimal.js'
import { D } from '@/server/domain/wholesale/money'

/*
 * Stock cover forecast (spec 13b): how many days an item's stock lasts at its recent sales speed. Plain arithmetic,
 * no AI, no I/O, no clock (the caller passes today's Asia/Baghdad date). Quantities are Decimal, never floats; only
 * whole day counts are JS numbers.
 *
 * Rulings:
 * - Rate = net base quantity over the window (sold minus GOOD returns; damaged returns are not passed in, they do not
 *   bring sellable stock back) divided by min(windowDays, activeDays). A negative net (more good returns than sales in
 *   the window) is a zero rate, never negative.
 * - windowDays / activeDays must be positive whole numbers: anything else is a programming error and throws
 *   ForecastInputError, so no Infinity or NaN can ever reach a page. Callers clamp activeDays with activeDaysOf.
 * - The divisions round DOWN (40 significant digits), so the rate is never above the exact one and a stock that lasts
 *   exactly N days at the exact rate is N, not N-1 (2 sold over 3 days with 2 on hand is 3 days).
 * - daysOfCover is floor(onHand / rate), null when the rate is zero (no recent sales: the page says "no sales", not a
 *   number). Nothing (or less than nothing) on hand of a selling item is 0.
 * - reorderBy = today + (cover - lead days); when that is today or earlier the answer is today. Null without a cover.
 */

/** Division that never rounds up (see the header). */
const DR = D.clone({ precision: 40, rounding: D.ROUND_DOWN })

export class ForecastInputError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'ForecastInputError'
  }
}

function assertDays(name: string, v: number): void {
  if (!Number.isInteger(v) || v <= 0) throw new ForecastInputError(`${name} must be a positive whole number of days, got ${String(v)}`)
}

/**
 * Net base units sold per day: (soldBase - returnedGoodBase) / days, where days = windowDays, or activeDays when the
 * item was first stocked inside the window (activeDays < windowDays). Never negative.
 */
export function dailyRate(soldBase: Decimal, returnedGoodBase: Decimal, windowDays: number, activeDays: number): Decimal {
  assertDays('windowDays', windowDays)
  assertDays('activeDays', activeDays)
  const net = new DR(soldBase).minus(returnedGoodBase)
  if (net.lte(0)) return new D(0)
  return new D(net.div(Math.min(windowDays, activeDays)))
}

/** Whole days the stock lasts at `rate` (floor), or null when the rate is zero (no recent sales). */
export function daysOfCover(onHandBase: Decimal, rate: Decimal): number | null {
  const r = new DR(rate)
  if (!r.isFinite() || r.lte(0)) return null
  const on = new DR(onHandBase)
  if (on.lte(0)) return 0
  return on.div(r).floor().toNumber()
}

const DAY_MS = 86_400_000
const dayNumber = (iso: string): number => Math.round(new Date(`${iso}T00:00:00Z`).getTime() / DAY_MS)
export const addDays = (iso: string, n: number): string => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10)

/**
 * Days of the window the item has been stocked: from its first stock date to today, both included, at most
 * windowDays and at least 1 (a first stock date after today still counts as one day). Never stocked: windowDays.
 */
export function activeDaysOf(today: string, firstStockDate: string | null, windowDays: number): number {
  assertDays('windowDays', windowDays)
  if (firstStockDate === null) return windowDays
  const days = dayNumber(today) - dayNumber(firstStockDate) + 1
  return Math.min(windowDays, Math.max(1, days))
}

/** The last day to place an order that arrives before the stock runs out (YYYY-MM-DD), never before today. */
export function reorderBy(today: string, coverDays: number | null, leadDays: number): string | null {
  if (coverDays === null) return null
  const slack = coverDays - leadDays
  return slack > 0 ? addDays(today, slack) : today
}
