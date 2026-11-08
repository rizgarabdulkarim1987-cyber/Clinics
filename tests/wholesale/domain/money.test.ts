import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { convert, formatAmount, formatSigned, roundMoney, toIqd, type Money } from '@/server/domain/wholesale/money'
import { RateMissingError, type DayRates } from '@/server/domain/wholesale/rates'

const rates: DayRates = {
  date: '2026-11-03',
  iqdPer: { IQD: new Decimal(1), USD: new Decimal(1310), IRT: new Decimal('0.0126') },
}
const m = (amount: string, currency: Money['currency']): Money => ({ amount: new Decimal(amount), currency })

describe('convert', () => {
  it('1 USD -> IQD is 1310', () => {
    const r = convert(m('1', 'USD'), 'IQD', rates)
    expect(r.currency).toBe('IQD')
    expect(r.amount.eq(1310)).toBe(true)
  })

  it('104000 IRT -> USD is 1.0000 within 4 dp (via IQD)', () => {
    const r = convert(m('104000', 'IRT'), 'USD', rates)
    expect(r.currency).toBe('USD')
    expect(r.amount.eq(new (Decimal.clone({ precision: 40 }))('1310.4').div(1310))).toBe(true)
    // (tolerance form: r.amount.minus(1).abs().lt('0.0005'); the brief's 1.0000 example was arithmetically off)
  })

  it('same currency returns the same Money, even with no rates', () => {
    const x = m('123.4567', 'IRT')
    expect(convert(x, 'IRT', rates)).toBe(x)
    const empty = { date: 'x', iqdPer: {} } as unknown as DayRates
    expect(convert(m('5', 'IQD'), 'IQD', empty).amount.eq(5)).toBe(true)
  })

  it('does not round: exact quotient is kept', () => {
    const r = convert(m('1', 'IQD'), 'USD', rates)
    expect(r.amount.eq(new Decimal(1).div(1310))).toBe(false) // default 20 digits would differ
    expect(r.amount.decimalPlaces()).toBeGreaterThan(10)
  })

  it('keeps precision on 10-figure IRT amounts', () => {
    const r = convert(m('9999999999.9999', 'IRT'), 'IQD', rates)
    expect(r.amount.eq(new Decimal('9999999999.9999').times('0.0126'))).toBe(true)
  })

  it('an all-IQD conversion needs no foreign rate', () => {
    expect(toIqd(m('77', 'IQD'), { date: 'x', iqdPer: { IQD: new Decimal(1) } } as unknown as DayRates).eq(77)).toBe(true)
  })

  it('toIqd converts foreign amounts', () => {
    expect(toIqd(m('2', 'USD'), rates).eq(2620)).toBe(true)
  })

  it('a missing rate throws RateMissingError', () => {
    const noUsd = { date: 'd', iqdPer: { IQD: new Decimal(1), IRT: new Decimal('0.0126') } } as unknown as DayRates
    expect(() => convert(m('1', 'USD'), 'IQD', noUsd)).toThrow(RateMissingError)
  })
})

describe('roundMoney', () => {
  it('rounds half up to display precision: IQD 2, USD 2, IRT 0', () => {
    expect(roundMoney(m('1.005', 'USD')).amount.toString()).toBe('1.01')
    expect(roundMoney(m('1.005', 'IQD')).amount.toString()).toBe('1.01')
    expect(roundMoney(m('2.5', 'IRT')).amount.toString()).toBe('3')
    expect(roundMoney(m('-2.5', 'IRT')).amount.toString()).toBe('-3')
    expect(roundMoney(m('1.004', 'USD')).currency).toBe('USD')
  })
})

describe('formatAmount', () => {
  it('groups thousands, rounds half-up, never prints -0', () => {
    expect(formatAmount('1950000000')).toBe('1,950,000,000')
    expect(formatAmount('12400.5')).toBe('12,401')
    expect(formatAmount('999.995', 2)).toBe('1,000.00')
    expect(formatAmount('-5000')).toBe('-5,000')
    expect(formatAmount('-0.4')).toBe('0')
    expect(formatAmount('0', 2)).toBe('0.00')
    expect(formatAmount('123456789012345678901234.5678', 4)).toBe('123,456,789,012,345,678,901,234.5678')
  })
})

describe('formatSigned', () => {
  it('puts the sign before the symbol and never prints -$0', () => {
    expect(formatSigned('-5', '$')).toBe('-$5')
    expect(formatSigned('1234.6', '$')).toBe('$1,235')
    expect(formatSigned('-0.3', '$')).toBe('$0')
    expect(formatSigned('-12.345', '$', 2)).toBe('-$12.35')
  })
})
