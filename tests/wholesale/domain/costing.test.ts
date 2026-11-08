import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  InsufficientStockError,
  InvalidStockError,
  NoStockToRecostError,
  assertQty,
  recostAvg,
  roundCost,
  weightedAvg,
} from '@/server/domain/wholesale/costing'

const d = (v: string) => new Decimal(v)

describe('weightedAvg', () => {
  it('avg of 10@100 then 10@200 = 150', () => {
    expect(weightedAvg(d('10'), d('100'), d('10'), d('200')).toFixed()).toBe('150')
  })

  it('weights by quantity: 30@100 then 10@200 = 125', () => {
    expect(weightedAvg(d('30'), d('100'), d('10'), d('200')).toFixed()).toBe('125')
  })

  it('receiving into zero on hand takes the incoming cost, whatever the old average was', () => {
    expect(weightedAvg(d('0'), d('999'), d('5'), d('120')).toFixed()).toBe('120')
  })

  it('is exact (unrounded) for repeating results; roundCost rounds half-up to 8 dp for storage', () => {
    const avg = weightedAvg(d('1'), d('1'), d('2'), d('0')) // 1/3
    expect(avg.toFixed(20)).toBe('0.33333333333333333333')
    expect(roundCost(avg).toFixed()).toBe('0.33333333')
    expect(roundCost(d('0.123456785')).toFixed()).toBe('0.12345679')
  })

  it('refuses negative or non-positive incoming quantity and negative costs', () => {
    expect(() => weightedAvg(d('1'), d('1'), d('0'), d('1'))).toThrow(InvalidStockError)
    expect(() => weightedAvg(d('-1'), d('1'), d('1'), d('1'))).toThrow(InvalidStockError)
    expect(() => weightedAvg(d('1'), d('1'), d('1'), d('-1'))).toThrow(InvalidStockError)
  })
})

describe('recostAvg', () => {
  it('adds a total cost to the on-hand value: 10@100 + 500 = 150', () => {
    expect(recostAvg(d('10'), d('100'), d('500')).toFixed()).toBe('150')
  })

  it('refuses when nothing is on hand', () => {
    expect(() => recostAvg(d('0'), d('100'), d('500'))).toThrow(NoStockToRecostError)
  })

  it('refuses a non-positive added cost', () => {
    expect(() => recostAvg(d('10'), d('100'), d('0'))).toThrow(InvalidStockError)
  })
})

describe('assertQty', () => {
  it('accepts a positive Decimal with at most 8 dp', () => {
    expect(assertQty(d('1.12345678')).toFixed()).toBe('1.12345678')
  })

  it('refuses numbers, zero, negatives, more than 8 dp and values that do not fit Decimal(24,8)', () => {
    expect(() => assertQty(1 as unknown as Decimal)).toThrow(InvalidStockError)
    expect(() => assertQty(d('0'))).toThrow(InvalidStockError)
    expect(() => assertQty(d('-1'))).toThrow(InvalidStockError)
    expect(() => assertQty(d('0.123456789'))).toThrow(InvalidStockError)
    expect(() => assertQty(d('1e16'))).toThrow(InvalidStockError)
  })
})

describe('InsufficientStockError', () => {
  it('carries the item, warehouse, available and requested quantities', () => {
    const e = new InsufficientStockError('item-1', 'wh-1', d('2'), d('3'))
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('InsufficientStockError')
    expect(e.itemId).toBe('item-1')
    expect(e.warehouseId).toBe('wh-1')
    expect(e.available.toFixed()).toBe('2')
    expect(e.requested.toFixed()).toBe('3')
  })
})
