import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  ODD_PRICE_RATIO,
  ODD_PRICE_WINDOW_DAYS,
  SALES_DROP_MIN_ACTIVE_DAYS,
  SALES_DROP_RATIO,
  SALES_DROP_TRAILING_DAYS,
  computeAlerts,
  type AlertInput,
} from '@/server/domain/wholesale/alerts'

const d = (v: string) => new Decimal(v)
const TODAY = '2041-03-15'
const week = (v: string) => Array.from({ length: SALES_DROP_TRAILING_DAYS }, () => d(v))

/** Ordinary trading: stock above its reorder point, debts not yet due, a normal day, list prices. */
const normal = (): AlertInput => ({
  today: TODAY,
  stock: [
    { itemId: 'rice', onHandBase: d('120'), reorderPoint: d('50') },
    { itemId: 'oil', onHandBase: d('8'), reorderPoint: null },
  ],
  receivables: [
    { id: 's1', kind: 'SALE', customerId: 'c1', dueDate: '2041-03-20', openIqd: d('500000') },
    { id: 'o1', kind: 'OPENING', customerId: 'c2', dueDate: null, openIqd: d('900000') },
  ],
  sales: { today: d('1000000'), trailing: week('1000000') },
  prices: [{ saleId: 'x1', saleLineId: 'l1', itemId: 'rice', date: TODAY, currency: 'IQD', officialPrice: d('25000'), finalPrice: d('24000') }],
})

const kinds = (input: AlertInput) => computeAlerts(input).map((a) => a.kind)

describe('computeAlerts', () => {
  it('computeAlerts flags low stock, overdue debt, sales drop, odd price', () => {
    const alerts = computeAlerts({
      today: TODAY,
      stock: [
        { itemId: 'rice', onHandBase: d('20'), reorderPoint: d('50') },
        { itemId: 'sugar', onHandBase: d('0'), reorderPoint: d('10') },
      ],
      receivables: [{ id: 's1', kind: 'SALE', customerId: 'c1', dueDate: '2041-03-14', openIqd: d('750000.5') }],
      sales: { today: d('300000'), trailing: week('1000000') },
      prices: [{ saleId: 'x1', saleLineId: 'l1', itemId: 'rice', date: '2041-03-14', currency: 'USD', officialPrice: d('20'), finalPrice: d('9.99') }],
    })
    expect(alerts.map((a) => a.kind).sort()).toEqual(['lowStock', 'lowStock', 'oddPrice', 'overdueDebt', 'salesDrop'])
    for (const a of alerts) expect(a.messageKey).toBe(`alert.${a.kind}`)

    const sugar = alerts.find((a) => a.refs.itemId === 'sugar')!
    expect(sugar).toMatchObject({ kind: 'lowStock', severity: 'high', params: { onHand: '0', reorderPoint: '10' } })
    expect(alerts.find((a) => a.refs.itemId === 'rice' && a.kind === 'lowStock')).toMatchObject({ severity: 'medium', params: { onHand: '20', reorderPoint: '50' } })
    expect(alerts.find((a) => a.kind === 'overdueDebt')).toMatchObject({
      refs: { customerId: 'c1', saleId: 's1' },
      params: { dueDate: '2041-03-14', daysOverdue: '1', openIqd: '750000.5' },
    })
    expect(alerts.find((a) => a.kind === 'salesDrop')).toMatchObject({ params: { today: '300000', average: '1000000', percent: '30' } })
    expect(alerts.find((a) => a.kind === 'oddPrice')).toMatchObject({
      refs: { saleId: 'x1', saleLineId: 'l1', itemId: 'rice' },
      params: { officialPrice: '20', finalPrice: '9.99', currency: 'USD', percent: '50' },
    })
    // the most severe first
    expect(alerts[0].severity).toBe('high')
  })

  it('no alerts on normal data', () => {
    expect(computeAlerts(normal())).toEqual([])
    expect(computeAlerts({ today: TODAY })).toEqual([])
  })

  it('reorderPoint equal is not low', () => {
    expect(kinds({ today: TODAY, stock: [{ itemId: 'rice', onHandBase: d('50'), reorderPoint: d('50') }] })).toEqual([])
    expect(kinds({ today: TODAY, stock: [{ itemId: 'rice', onHandBase: d('49.99999999'), reorderPoint: d('50') }] })).toEqual(['lowStock'])
  })

  it('a debt due today is not overdue; paid-off debts and debts with no due date never are', () => {
    const r = (dueDate: string | null, open = '100') => ({ today: TODAY, receivables: [{ id: 's', kind: 'SALE' as const, customerId: 'c', dueDate, openIqd: d(open) }] })
    expect(kinds(r(TODAY))).toEqual([])
    expect(kinds(r('2041-03-14', '0'))).toEqual([])
    expect(kinds(r(null))).toEqual([])
    expect(kinds(r('2041-03-14'))).toEqual(['overdueDebt'])
    // an opening debt refs the debt, not a sale
    expect(computeAlerts({ today: TODAY, receivables: [{ id: 'o', kind: 'OPENING', customerId: 'c', dueDate: '2041-01-01', openIqd: d('5') }] })[0]).toMatchObject({
      severity: 'high',
      refs: { customerId: 'c', openingDebtId: 'o' },
      params: { daysOverdue: '73' },
    })
  })

  it('exactly 70% of the trailing average is not a drop; just under is', () => {
    expect(SALES_DROP_RATIO).toBe('0.7')
    expect(kinds({ today: TODAY, sales: { today: d('700'), trailing: week('1000') } })).toEqual([])
    expect(kinds({ today: TODAY, sales: { today: d('699.9999'), trailing: week('1000') } })).toEqual(['salesDrop'])
  })

  it('a zero trailing average, or too few trading days, raises no sales drop', () => {
    expect(kinds({ today: TODAY, sales: { today: d('0'), trailing: week('0') } })).toEqual([])
    const sparse = [d('7000'), ...Array.from({ length: SALES_DROP_TRAILING_DAYS - 1 }, () => d('0'))]
    expect(SALES_DROP_MIN_ACTIVE_DAYS).toBeGreaterThan(1)
    expect(kinds({ today: TODAY, sales: { today: d('0'), trailing: sparse } })).toEqual([])
    // fewer than SALES_DROP_TRAILING_DAYS days of history: not enough data
    expect(kinds({ today: TODAY, sales: { today: d('0'), trailing: week('1000').slice(1) } })).toEqual([])
  })

  it('exactly 50% of the official price is not odd; just under is; old sales and zero list prices are ignored', () => {
    expect(ODD_PRICE_RATIO).toBe('0.5')
    const p = (finalPrice: string, date = TODAY, officialPrice = '1000') => ({
      today: TODAY,
      prices: [{ saleId: 's', saleLineId: 'l', itemId: 'i', date, currency: 'IQD' as const, officialPrice: d(officialPrice), finalPrice: d(finalPrice) }],
    })
    expect(kinds(p('500'))).toEqual([])
    expect(kinds(p('499.9999'))).toEqual(['oddPrice'])
    // the window is the last 7 calendar days including today: 6 days ago is in, 7 days ago is out
    expect(ODD_PRICE_WINDOW_DAYS).toBe(7)
    expect(kinds(p('100', '2041-03-09'))).toEqual(['oddPrice'])
    expect(kinds(p('100', '2041-03-08'))).toEqual([])
    expect(kinds(p('0', TODAY, '0'))).toEqual([])
  })

  it('low cover: days of cover (all warehouses) below the reorder lead days; equal or no recent sales never alerts', () => {
    const c = (coverDays: number | null, leadDays = 14) => ({ today: TODAY, cover: { leadDays, rows: [{ itemId: 'rice', coverDays, reorderBy: coverDays === null ? null : TODAY }] } })
    expect(kinds(c(14))).toEqual([])
    expect(kinds(c(15))).toEqual([])
    expect(kinds(c(null))).toEqual([])
    expect(kinds(c(13))).toEqual(['lowCover'])
    expect(computeAlerts(c(13))[0]).toMatchObject({ kind: 'lowCover', messageKey: 'alert.lowCover', severity: 'medium', refs: { itemId: 'rice' }, params: { coverDays: '13', leadDays: '14', reorderBy: TODAY } })
    // nothing left of an item that sells: high
    expect(computeAlerts(c(0))[0]).toMatchObject({ severity: 'high', params: { coverDays: '0' } })
    // normal data plus a comfortable cover raises nothing
    expect(computeAlerts({ ...normal(), cover: { leadDays: 14, rows: [{ itemId: 'rice', coverDays: 60, reorderBy: '2041-04-30' }] } })).toEqual([])
  })
})
