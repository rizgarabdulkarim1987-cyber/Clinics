import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { InvalidConversionError, InvalidCustodyError, conversionAmounts, custodyRate, expenseAccount, parseMoneyList, EXPENSE_CATEGORIES } from '@/server/domain/wholesale/treasury'
import { REQUIRED_ACCOUNT_CODES } from '@/server/domain/wholesale/ledger'

const d = (v: string) => new Decimal(v)
const rates = { date: '2040-03-01', iqdPer: { IQD: d('1'), USD: d('1310'), IRT: d('0.0126') } }

describe('treasury rules', () => {
  it('conversionAmounts: exact USD -> IQD has no FX', () => {
    const a = conversionAmounts(d('1000'), 'USD', 'IQD', rates)
    expect([a.toAmount, a.fromIqd, a.toIqd, a.fxDiffIqd].map((x) => x.toFixed())).toEqual(['1310000', '1310000', '1310000', '0'])
    expect(a.fxLine).toBeNull()
  })

  it('conversionAmounts: rounding of the target to 4 dp -> FX line at >= 0.01 IQD, none below', () => {
    expect(conversionAmounts(d('1000000'), 'IQD', 'USD', rates).fxLine).toEqual({ account: 'FX_GAIN', amountIqd: expect.anything() })
    expect(conversionAmounts(d('1000001'), 'IQD', 'USD', rates).fxLine?.account).toBe('FX_LOSS')
    const small = conversionAmounts(d('10000000'), 'IRT', 'USD', rates)
    expect(small.fxDiffIqd.toFixed()).toBe('-0.008')
    expect(small.fxLine).toBeNull()
  })

  it('conversionAmounts refuses the same currency and a result worth nothing', () => {
    expect(() => conversionAmounts(d('1'), 'USD', 'USD', rates)).toThrow(InvalidConversionError)
    expect(() => conversionAmounts(d('1'), 'IRT', 'USD', rates)).toThrow(InvalidConversionError)
  })

  it('custodyRate is the average IQD rate (8 dp), 1 for IQD, null with nothing to average', () => {
    expect(custodyRate('USD', { amount: d('200'), iqd: d('263000') })?.toFixed()).toBe('1315')
    expect(custodyRate('USD', { amount: d('3'), iqd: d('4000') })?.toFixed()).toBe('1333.33333333')
    expect(custodyRate('IQD', { amount: d('0'), iqd: d('0') })?.toFixed()).toBe('1')
    expect(custodyRate('USD', { amount: d('0'), iqd: d('5') })).toBeNull()
  })

  it('parseMoneyList: one amount per currency, zero only where allowed', () => {
    expect([...parseMoneyList([{ amount: '5', currency: 'USD' }, { amount: d('0'), currency: 'IQD' }], 'x', 'zero')].map(([c, a]) => `${c} ${a.toFixed()}`)).toEqual(['USD 5', 'IQD 0'])
    expect(() => parseMoneyList([{ amount: '0', currency: 'USD' }], 'x', 'positive')).toThrow(InvalidCustodyError)
    expect(() => parseMoneyList([{ amount: '1', currency: 'USD' }, { amount: '1', currency: 'USD' }], 'x', 'zero')).toThrow(InvalidCustodyError)
    expect(() => parseMoneyList([], 'x', 'zero')).toThrow(InvalidCustodyError)
  })

  it('every expense category maps to a seeded EXPENSE_* account', () => {
    for (const c of EXPENSE_CATEGORIES) expect(REQUIRED_ACCOUNT_CODES as readonly string[]).toContain(expenseAccount(c))
  })
})
