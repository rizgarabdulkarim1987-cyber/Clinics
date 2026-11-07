import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { D } from '@/server/domain/wholesale/money'
import { RateMissingError } from '@/server/domain/wholesale/rates'
import { InvalidCatalogError, displayName, parseDecimal, validateNames } from '@/server/domain/wholesale/catalog'
import { MissingUnitError, priceInCurrency, priceLine, toBase, type ItemWithUnits } from '@/server/domain/wholesale/pricing'

const biscuits: ItemWithUnits = {
  baseUnit: 'PIECE',
  units: [
    { unit: 'PIECE', factorToBase: new D(1) },
    { unit: 'CARTON', factorToBase: new D(24) },
  ],
}
const rice: ItemWithUnits = {
  baseUnit: 'CARTON',
  units: [
    { unit: 'CARTON', factorToBase: new D(1) },
    { unit: 'TON', factorToBase: new D(40) },
  ],
}

describe('toBase', () => {
  it('1 CARTON of 24 pieces is 24 base units', () => {
    expect(toBase(new D(1), 'CARTON', biscuits).eq(24)).toBe(true)
  })
  it('the base unit has factor 1', () => {
    expect(toBase(new D(7), 'PIECE', biscuits).eq(7)).toBe(true)
  })
  it('fractional quantities are allowed (0.5 TON)', () => {
    expect(toBase(new D('0.5'), 'TON', rice).eq(20)).toBe(true)
    expect(toBase(new D('2.5'), 'CARTON', biscuits).eq(60)).toBe(true)
  })
  it('accepts string factors as they come from the database', () => {
    const item: ItemWithUnits = { baseUnit: 'PIECE', units: [{ unit: 'CARTON', factorToBase: '24.00000000' }] }
    expect(toBase(new D(2), 'CARTON', item).eq(48)).toBe(true)
  })
  it('throws a clear error when the item lacks the unit', () => {
    expect(() => toBase(new D(1), 'TON', biscuits)).toThrow(MissingUnitError)
    expect(() => toBase(new D(1), 'TON', biscuits)).toThrow(/TON/)
  })
  it('does not lose precision on small fractions', () => {
    const item: ItemWithUnits = { baseUnit: 'PIECE', units: [{ unit: 'TON', factorToBase: '1000.12345678' }] }
    expect(toBase(new D('0.00000001'), 'TON', item).toString()).toBe('0.0000100012345678')
  })
})

describe('priceLine', () => {
  it('PERCENT 10 on 1000 -> final 900, discount 100', () => {
    const r = priceLine({ official: new D(1000), mode: 'PERCENT', percent: new D(10) })
    expect(r.official.eq(1000)).toBe(true)
    expect(r.final.eq(900)).toBe(true)
    expect(r.discount.eq(100)).toBe(true)
  })
  it('MANUAL 850 keeps official 1000 and discount 150', () => {
    const r = priceLine({ official: new D(1000), mode: 'MANUAL', manual: new D(850) })
    expect(r.official.eq(1000)).toBe(true)
    expect(r.final.eq(850)).toBe(true)
    expect(r.discount.eq(150)).toBe(true)
  })
  it('OFFICIAL -> discount 0', () => {
    const r = priceLine({ official: new D(1000), mode: 'OFFICIAL' })
    expect(r.final.eq(1000)).toBe(true)
    expect(r.discount.eq(0)).toBe(true)
  })
  it('is exact for awkward percents (no float error)', () => {
    const r = priceLine({ official: new D('333.33'), mode: 'PERCENT', percent: new D('12.5') })
    expect(r.final.toString()).toBe('291.66375')
    expect(r.discount.toString()).toBe('41.66625')
    expect(r.final.plus(r.discount).eq('333.33')).toBe(true)
  })
  it('rejects a missing, negative or over-100 percent and a missing or negative manual price', () => {
    const bad = [
      { official: new D(1000), mode: 'PERCENT' as const },
      { official: new D(1000), mode: 'PERCENT' as const, percent: new D(-1) },
      { official: new D(1000), mode: 'PERCENT' as const, percent: new D(101) },
      { official: new D(1000), mode: 'PERCENT' as const, percent: new D(NaN) },
      { official: new D(1000), mode: 'MANUAL' as const },
      { official: new D(1000), mode: 'MANUAL' as const, manual: new D(-1) },
      { official: new D(-5), mode: 'OFFICIAL' as const },
    ]
    for (const p of bad) expect(() => priceLine(p)).toThrow(InvalidCatalogError)
  })
  it('uses the shared 40-digit Decimal, not the global one', () => {
    const r = priceLine({ official: new Decimal('1000000000000000.1234'), mode: 'PERCENT', percent: new Decimal(10) })
    expect(r.final.toString()).toBe('900000000000000.11106')
  })
})

describe('priceInCurrency', () => {
  const rates = { date: '2031-01-01', iqdPer: { IQD: new D(1), USD: new D(1310), IRT: new D('0.0126') } }
  it('IQD is returned as is and needs no rates', () => {
    expect(priceInCurrency(new D(900), 'IQD', { date: '2031-01-01', iqdPer: {} }).eq(900)).toBe(true)
  })
  it('converts with the day rate and does not round', () => {
    expect(priceInCurrency(new D(1310), 'USD', rates).eq(1)).toBe(true)
    const usd = priceInCurrency(new D(1000), 'USD', rates)
    expect(usd.toString()).toBe(new D(1000).div(1310).toString())
    expect(usd.decimalPlaces()).toBeGreaterThan(8)
    expect(priceInCurrency(new D(126), 'IRT', rates).eq(10000)).toBe(true)
  })
  it('throws RateMissingError when the day has no rate for the currency', () => {
    expect(() => priceInCurrency(new D(1000), 'USD', { date: '2031-01-01', iqdPer: { IQD: new D(1) } })).toThrow(RateMissingError)
  })
})

describe('catalog validation', () => {
  it('requires at least one non-empty name', () => {
    expect(() => validateNames({ ckb: '', ar: '  ', en: '' })).toThrow(InvalidCatalogError)
    expect(validateNames({ ckb: ' برنج ', ar: '', en: '' })).toEqual({ ckb: 'برنج', ar: '', en: '' })
  })
  it('displayName falls back ckb -> ar -> en and prefers the locale', () => {
    expect(displayName({ ckb: '', ar: 'رز', en: 'Rice' })).toBe('رز')
    expect(displayName({ ckb: '', ar: '', en: 'Rice' })).toBe('Rice')
    expect(displayName({ ckb: 'برنج', ar: 'رز', en: 'Rice' }, 'en')).toBe('Rice')
    expect(displayName({ ckb: 'برنج', ar: 'رز', en: '' }, 'en')).toBe('برنج')
  })
  it('parseDecimal rejects numbers, junk, negatives and overflow, and rounds to the column scale', () => {
    expect(parseDecimal('12.34567', { dp: 4, label: 'x' }).toString()).toBe('12.3457')
    expect(() => parseDecimal(5 as unknown as string, { dp: 4, label: 'x' })).toThrow(InvalidCatalogError)
    expect(() => parseDecimal('abc', { dp: 4, label: 'x' })).toThrow(InvalidCatalogError)
    expect(() => parseDecimal('-1', { dp: 4, label: 'x' })).toThrow(InvalidCatalogError)
    expect(() => parseDecimal('0', { dp: 4, label: 'x', positive: true })).toThrow(InvalidCatalogError)
    expect(() => parseDecimal('1e30', { dp: 4, label: 'x' })).toThrow(InvalidCatalogError)
  })
})
