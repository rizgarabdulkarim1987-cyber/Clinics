import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  AMOUNT_MAX,
  CHART_OF_ACCOUNTS,
  InvalidEntryError,
  REQUIRED_ACCOUNT_CODES,
  UnbalancedEntryError,
  currenciesOf,
  mirrorLines,
  priceLines,
  type LineInput,
} from '@/server/domain/wholesale/ledger'
import type { PartialRates } from '@/server/domain/wholesale/money'

const d = (v: string) => new Decimal(v)
const rates: PartialRates = { date: '2032-01-01', iqdPer: { IQD: d('1'), USD: d('1310'), IRT: d('0.0126') } }
const line = (accountCode: string, side: 'DR' | 'CR', amount: string, currency: LineInput['currency'] = 'IQD'): LineInput => ({
  accountCode,
  side,
  amount: d(amount),
  currency,
})

describe('priceLines', () => {
  it('foreign-currency entry balances in IQD with a USD line', () => {
    const out = priceLines([line('CASH_USD', 'DR', '100', 'USD'), line('SALES', 'CR', '131000')], rates)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ accountCode: 'CASH_USD', side: 'DR', currency: 'USD' })
    expect(out[0].amount.eq(100)).toBe(true)
    expect(out[0].rateIqd.eq(1310)).toBe(true)
    expect(out[0].baseIqd.eq(131000)).toBe(true)
    expect(out[1].rateIqd.eq(1)).toBe(true)
    expect(out[1].baseIqd.eq(131000)).toBe(true)
  })

  it('rounds each baseIqd once to 4 dp half-up and balances on the rounded values', () => {
    const r: PartialRates = { date: '2032-01-01', iqdPer: { IQD: d('1'), USD: d('1310.12345678') } }
    const out = priceLines([line('CASH_USD', 'DR', '1', 'USD'), line('SALES', 'CR', '1310.1235')], r)
    expect(out[0].baseIqd.toFixed()).toBe('1310.1235')
    expect(out).toHaveLength(2) // no ROUNDING line: stored values balance exactly
  })

  it('keeps precision on 10-figure IRT amounts', () => {
    const out = priceLines([line('CASH_IRT', 'DR', '9876543210', 'IRT'), line('SALES', 'CR', '124444444.446')], rates)
    expect(out[0].baseIqd.toFixed()).toBe('124444444.446')
    expect(out).toHaveLength(2)
  })

  it('a one-fils rounding diff goes to ROUNDING', () => {
    const out = priceLines([line('AR', 'DR', '1000.001'), line('SALES', 'CR', '1000')], rates)
    expect(out).toHaveLength(3)
    expect(out[2]).toMatchObject({ accountCode: 'ROUNDING', side: 'CR', currency: 'IQD' })
    expect(out[2].amount.toFixed()).toBe('0.001')
    expect(out[2].baseIqd.toFixed()).toBe('0.001')
    // credits short -> ROUNDING on the debit side
    const out2 = priceLines([line('AR', 'DR', '1000'), line('SALES', 'CR', '1000.0099')], rates)
    expect(out2[2]).toMatchObject({ accountCode: 'ROUNDING', side: 'DR' })
    expect(out2[2].amount.toFixed()).toBe('0.0099')
  })

  it('a diff of 0.01 IQD or more throws UnbalancedEntryError', () => {
    expect(() => priceLines([line('AR', 'DR', '1000.01'), line('SALES', 'CR', '1000')], rates)).toThrow(UnbalancedEntryError)
    expect(() => priceLines([line('AR', 'DR', '1000'), line('SALES', 'CR', '1500')], rates)).toThrow(UnbalancedEntryError)
  })

  it('an entry with 1e15-scale amounts balances exactly', () => {
    const big = '999999999999999.9999'
    const out = priceLines([line('AR', 'DR', big), line('SALES', 'CR', big)], rates)
    expect(out).toHaveLength(2)
    expect(out[0].baseIqd.toFixed()).toBe(big)
    const usd = priceLines([line('CASH_USD', 'DR', '700000000000', 'USD'), line('SALES', 'CR', '917000000000000')], rates)
    expect(usd[0].baseIqd.toFixed()).toBe('917000000000000')
  })

  it('sums keep every digit beyond 20 significant digits (precision regression)', () => {
    // 11 x 999999999999999.9999 = 10999999999999999.9989 (21 significant digits): the 20-digit global Decimal
    // would round the sum and lose the 0.0001 difference.
    const big = '999999999999999.9999'
    const drs = Array.from({ length: 11 }, () => line('AR', 'DR', big))
    const crs = Array.from({ length: 10 }, () => line('SALES', 'CR', big))
    const exact = priceLines([...drs, ...crs, line('SALES', 'CR', big)], rates)
    expect(exact).toHaveLength(22) // balances exactly, no ROUNDING line
    const off = priceLines([...drs, ...crs, line('SALES', 'CR', '999999999999999.9998')], rates)
    expect(off).toHaveLength(23)
    expect(off[22]).toMatchObject({ accountCode: 'ROUNDING', side: 'CR' })
    expect(off[22].amount.toFixed()).toBe('0.0001')
  })

  it('rejects an amount above the 1e15 per-line cap', () => {
    expect(AMOUNT_MAX.toFixed()).toBe('1000000000000000')
    expect(() => priceLines([line('AR', 'DR', '1000000000000000'), line('SALES', 'CR', '1000000000000000')], rates)).toThrow(
      InvalidEntryError,
    )
    expect(() =>
      priceLines([line('AR', 'DR', '12345678901234567.0001'), line('SALES', 'CR', '12345678901234567.0001')], rates),
    ).toThrow(InvalidEntryError)
    // a USD amount under the cap whose IQD value exceeds it is rejected too
    expect(() => priceLines([line('CASH_USD', 'DR', '1000000000000', 'USD'), line('SALES', 'CR', '1')], rates)).toThrow(
      InvalidEntryError,
    )
  })

  it('rejects a one-sided entry even when ROUNDING could balance it', () => {
    expect(() => priceLines([line('AR', 'DR', '0.001'), line('SALES', 'DR', '0.002')], rates)).toThrow(InvalidEntryError)
    expect(() => priceLines([line('AR', 'CR', '0.001'), line('SALES', 'CR', '0.002')], rates)).toThrow(InvalidEntryError)
  })

  it('rejects zero, negative, NaN, too-precise, non-Decimal amounts and short entries', () => {
    const bad: LineInput[][] = [
      [line('AR', 'DR', '0'), line('SALES', 'CR', '0')],
      [line('AR', 'DR', '-5'), line('SALES', 'CR', '-5')],
      [line('AR', 'DR', 'NaN'), line('SALES', 'CR', '5')],
      [line('AR', 'DR', 'Infinity'), line('SALES', 'CR', 'Infinity')],
      [line('AR', 'DR', '1.00001'), line('SALES', 'CR', '1.00001')],
      [line('AR', 'DR', '1e20'), line('SALES', 'CR', '1e20')],
      [{ ...line('AR', 'DR', '5'), amount: 5 as unknown as Decimal }, line('SALES', 'CR', '5')],
      [{ ...line('AR', 'DR', '5'), side: 'XX' as 'DR' }, line('SALES', 'CR', '5')],
      [{ ...line('AR', 'DR', '5'), currency: 'EUR' as 'IQD' }, line('SALES', 'CR', '5')],
      [{ ...line('AR', 'DR', '5'), accountCode: '' }, line('SALES', 'CR', '5')],
      [line('AR', 'DR', '5')],
      [],
    ]
    for (const lines of bad) expect(() => priceLines(lines, rates)).toThrow(InvalidEntryError)
  })
})

describe('pinned line rate', () => {
  it('a line with rateIqd uses that rate instead of the day rate', () => {
    // AP carried at the purchase-day rate 1300, cash paid at today's 1310: the gap balances to FX_LOSS
    const out = priceLines(
      [{ ...line('AP', 'DR', '100', 'USD'), rateIqd: d('1300') }, line('FX_LOSS', 'DR', '1000'), line('CASH_USD', 'CR', '100', 'USD')],
      rates,
    )
    expect(out[0].rateIqd.toFixed()).toBe('1300')
    expect(out[0].baseIqd.toFixed()).toBe('130000')
    expect(out[2].rateIqd.toFixed()).toBe('1310')
    expect(out).toHaveLength(3)
  })

  it('pinned lines need no day rate, and bad pinned rates are refused', () => {
    expect(currenciesOf([{ ...line('AP', 'DR', '1', 'USD'), rateIqd: d('1300') }, line('CASH_IQD', 'CR', '1300')])).toEqual(['IQD'])
    const none: PartialRates = { date: '2032-01-01', iqdPer: { IQD: d('1') } }
    expect(priceLines([{ ...line('AP', 'DR', '1', 'USD'), rateIqd: d('1300') }, line('CASH_IQD', 'CR', '1300')], none)[0].baseIqd.toFixed()).toBe('1300')
    for (const r of [d('0'), d('-1'), d('1.123456789'), d('1e10'), 1300 as unknown as Decimal])
      expect(() => priceLines([{ ...line('AP', 'DR', '1', 'USD'), rateIqd: r }, line('CASH_IQD', 'CR', '1300')], rates)).toThrow(InvalidEntryError)
    expect(() => priceLines([{ ...line('AP', 'DR', '1'), rateIqd: d('2') }, line('CASH_IQD', 'CR', '2')], rates)).toThrow(InvalidEntryError)
  })
})

describe('ledger helpers', () => {
  it('currenciesOf lists only the currencies used', () => {
    expect(currenciesOf([line('AR', 'DR', '1'), line('SALES', 'CR', '1')])).toEqual(['IQD'])
    expect(currenciesOf([line('CASH_USD', 'DR', '1', 'USD'), line('SALES', 'CR', '1310')]).sort()).toEqual(['IQD', 'USD'])
  })

  it('mirrorLines flips sides and keeps amounts, currency, rate and base', () => {
    const priced = priceLines([line('CASH_USD', 'DR', '100', 'USD'), line('SALES', 'CR', '131000')], rates)
    const m = mirrorLines(priced)
    expect(m.map((l) => l.side)).toEqual(['CR', 'DR'])
    expect(m[0].amount.eq(priced[0].amount) && m[0].rateIqd.eq(1310) && m[0].baseIqd.eq(131000)).toBe(true)
    expect(m[0].currency).toBe('USD')
  })
})

describe('chart of accounts', () => {
  it('has every required code, unique codes, valid parents and names in three locales', () => {
    const codes = CHART_OF_ACCOUNTS.map((a) => a.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of REQUIRED_ACCOUNT_CODES) expect(codes).toContain(c)
    for (const c of ['EXPENSE_RENT', 'EXPENSE_SALARIES', 'EXPENSE_FUEL', 'EXPENSE_TRANSPORT', 'EXPENSE_UTILITIES', 'EXPENSE_OTHER'])
      expect(codes).toContain(c)
    for (const a of CHART_OF_ACCOUNTS) {
      expect(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'CONTRA']).toContain(a.type)
      for (const loc of ['ckb', 'ar', 'en'] as const) expect(a.name[loc].trim().length).toBeGreaterThan(0)
      if (a.parentCode) expect(codes).toContain(a.parentCode)
    }
    const cur = Object.fromEntries(CHART_OF_ACCOUNTS.map((a) => [a.code, a.currency ?? null]))
    expect([cur.CASH_IQD, cur.CASH_USD, cur.CASH_IRT, cur.ROUNDING, cur.AR]).toEqual(['IQD', 'USD', 'IRT', null, null])
  })
})
