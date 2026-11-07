import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { AllocationError, allocate } from '@/server/domain/wholesale/allocate'

const d = (v: string) => new Decimal(v)
const sum = (xs: Decimal[]) => xs.reduce((a, b) => a.plus(b), d('0'))
const s = (xs: Decimal[]) => xs.map((x) => x.toFixed())

describe('allocate', () => {
  it('allocate(100, [1,1,1]) sums to exactly 100', () => {
    const parts = allocate(d('100'), [d('1'), d('1'), d('1')])
    expect(sum(parts).toFixed()).toBe('100')
    expect(s(parts)).toEqual(['33.3334', '33.3333', '33.3333'])
  })

  it('sums exactly with awkward weights and amounts', () => {
    const cases: [string, string[]][] = [
      ['0.0001', ['1', '1', '1']],
      ['999999.9999', ['3', '7', '11', '13', '0.0001']],
      ['12345678901.2345', ['0.3333', '0.3333', '0.3334', '1234567.891', '2']],
      ['1', ['1e-8', '1e-8', '99999999']],
      ['7', ['2', '0', '5']],
    ]
    for (const [total, ws] of cases) {
      const parts = allocate(d(total), ws.map(d))
      expect(sum(parts).toFixed()).toBe(d(total).toFixed())
      expect(parts.every((p) => p.decimalPlaces() <= 4 && !p.isNegative())).toBe(true)
    }
    expect(s(allocate(d('7'), [d('2'), d('0'), d('5')]))).toEqual(['2', '0', '5'])
  })

  it('gives each part within one unit of the 4th decimal of its exact share', () => {
    const ws = ['17', '29', '31', '43'].map(d)
    const total = d('1000.0003')
    const parts = allocate(total, ws)
    const W = sum(ws)
    parts.forEach((p, i) => expect(p.minus(total.times(ws[i]).div(W)).abs().lt('0.0001')).toBe(true))
  })

  it('a single weight returns the total', () => {
    expect(s(allocate(d('123.4567'), [d('5')]))).toEqual(['123.4567'])
  })

  it('honours a dp argument', () => {
    expect(s(allocate(d('10'), [d('1'), d('1'), d('1')], 0))).toEqual(['4', '3', '3'])
  })

  it('rejects all-zero weights, negative weights, no weights, and a total with too many decimals', () => {
    expect(() => allocate(d('100'), [d('0'), d('0')])).toThrow(AllocationError)
    expect(() => allocate(d('100'), [d('1'), d('-1')])).toThrow(AllocationError)
    expect(() => allocate(d('100'), [])).toThrow(AllocationError)
    expect(() => allocate(d('1.00001'), [d('1')])).toThrow(AllocationError)
    expect(() => allocate(d('-1'), [d('1')])).toThrow(AllocationError)
    expect(() => allocate(d('1'), [1 as unknown as Decimal])).toThrow(AllocationError)
  })
})
