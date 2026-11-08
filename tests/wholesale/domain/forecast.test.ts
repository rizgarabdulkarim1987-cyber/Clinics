import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { ForecastInputError, activeDaysOf, dailyRate, daysOfCover, reorderBy } from '@/server/domain/wholesale/forecast'

const d = (v: string | number) => new Decimal(v)
const TODAY = '2041-03-01'

describe('dailyRate and daysOfCover', () => {
  it('300 sold over a 30-day window gives rate 10 and 120 on hand gives 12 days', () => {
    const rate = dailyRate(d(300), d(0), 30, 30)
    expect(rate.toFixed()).toBe('10')
    expect(daysOfCover(d(120), rate)).toBe(12)
  })

  it('zero sales gives daysOfCover null, not Infinity or an error', () => {
    const rate = dailyRate(d(0), d(0), 30, 30)
    expect(rate.isZero()).toBe(true)
    expect(daysOfCover(d(120), rate)).toBeNull()
    expect(daysOfCover(d(0), rate)).toBeNull()
  })

  it('an item stocked 5 days ago with 50 sold uses 5 active days, rate 10', () => {
    expect(dailyRate(d(50), d(0), 30, 5).toFixed()).toBe('10')
    // an item stocked before the window starts uses the whole window
    expect(dailyRate(d(300), d(0), 30, 30).toFixed()).toBe('10')
  })

  it('good returns reduce the net rate (the damaged ones are never passed in)', () => {
    expect(dailyRate(d(300), d(30), 30, 30).toFixed()).toBe('9')
  })

  it('more good returns than sales in the window is a zero rate, never a negative one', () => {
    const rate = dailyRate(d(10), d(25), 30, 30)
    expect(rate.isZero()).toBe(true)
    expect(rate.isNegative()).toBe(false)
    expect(daysOfCover(d(50), rate)).toBeNull()
  })

  it('cover is floored, exact even when the rate does not divide evenly', () => {
    // 2 sold over 3 days: rate 0.666..., 2 on hand lasts exactly 3 days (never 2.999... floored to 2)
    expect(daysOfCover(d(2), dailyRate(d(2), d(0), 3, 3))).toBe(3)
    // 100 over 30 days: 100 on hand lasts exactly 30 days
    expect(daysOfCover(d(100), dailyRate(d(100), d(0), 30, 30))).toBe(30)
    expect(daysOfCover(d(10), dailyRate(d(100), d(0), 30, 30))).toBe(3)
    // fractional base quantities (a TON item)
    expect(daysOfCover(d('0.5'), dailyRate(d('1.5'), d(0), 30, 30))).toBe(10)
  })

  it('nothing on hand is 0 days of cover when the item sells', () => {
    expect(daysOfCover(d(0), d(4))).toBe(0)
  })

  it('refuses a non-positive or fractional window / active days instead of returning Infinity or NaN', () => {
    expect(() => dailyRate(d(10), d(0), 0, 30)).toThrow(ForecastInputError)
    expect(() => dailyRate(d(10), d(0), 30, 0)).toThrow(ForecastInputError)
    expect(() => dailyRate(d(10), d(0), -5, 3)).toThrow(ForecastInputError)
    expect(() => dailyRate(d(10), d(0), 2.5, 2)).toThrow(ForecastInputError)
    expect(() => dailyRate(d(10), d(0), Number.NaN, 2)).toThrow(ForecastInputError)
  })
})

describe('activeDaysOf', () => {
  it('counts the days from the first stock date to today inclusive, capped by the window, at least 1', () => {
    expect(activeDaysOf(TODAY, '2041-02-25', 30)).toBe(5)
    expect(activeDaysOf(TODAY, TODAY, 30)).toBe(1)
    expect(activeDaysOf(TODAY, '2040-01-01', 30)).toBe(30)
    // a first stock date after today (a future-dated receipt) still divides by one day, never zero
    expect(activeDaysOf(TODAY, '2041-03-05', 30)).toBe(1)
    // never stocked: the whole window
    expect(activeDaysOf(TODAY, null, 30)).toBe(30)
  })
})

describe('reorderBy', () => {
  it('reorderBy equals today when cover is already below lead days', () => {
    expect(reorderBy(TODAY, 5, 14)).toBe(TODAY)
    expect(reorderBy(TODAY, 0, 14)).toBe(TODAY)
    // exactly the lead time left: order today
    expect(reorderBy(TODAY, 14, 14)).toBe(TODAY)
  })

  it('is today plus (cover minus lead days) otherwise, across a month end', () => {
    expect(reorderBy(TODAY, 20, 14)).toBe('2041-03-07')
    expect(reorderBy('2041-02-27', 16, 14)).toBe('2041-03-01')
  })

  it('is null when there is no cover figure (no recent sales)', () => {
    expect(reorderBy(TODAY, null, 14)).toBeNull()
  })
})
