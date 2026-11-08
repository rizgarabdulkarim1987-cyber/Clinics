import type Decimal from 'decimal.js'
import { D } from '@/server/domain/wholesale/money'
import type { Currency } from '@/server/domain/wholesale/rates'

/*
 * Dashboard alerts: plain rules over numbers the server has already gathered. No AI, no I/O, no clock (the caller
 * passes `today`, the Asia/Baghdad date). Every alert carries a message key and string params; the page renders the
 * text in the viewer's language, so nothing here is user-facing text.
 *
 * Rules (thresholds are the named constants below; each comparison is strict, so the exact boundary never alerts):
 * - lowStock: an item with a reorderPoint whose on-hand quantity (base units) is BELOW it. The server passes the MAIN
 *   warehouse quantity: that is the stock the company reorders into (rep warehouses are refilled from it).
 *   On hand 0 is high severity, otherwise medium.
 * - overdueDebt: an open receivable (open > 0) whose dueDate is BEFORE today (due today is not overdue). Documents
 *   without a due date (cash-like credit sales, opening debts) never become overdue. More than 30 days late is high.
 * - salesDrop: today's net sales so far BELOW SALES_DROP_RATIO x the average of the previous SALES_DROP_TRAILING_DAYS
 *   days, only when that average is above zero and at least SALES_DROP_MIN_ACTIVE_DAYS of those days had sales (one
 *   lucky day in an otherwise empty week is not a baseline). It compares the day so far, so it can fire in the
 *   morning and clear itself later in the day.
 * - oddPrice: a posted sale line of the last ODD_PRICE_WINDOW_DAYS calendar days (today included) whose final unit
 *   price is BELOW ODD_PRICE_RATIO x its official (list) price at the time of sale, both in the sale currency as stored
 *   on the line. Lines with a zero list price are ignored.
 * - lowCover (Task 13b): an item whose days of cover (all warehouses except DAMAGE, src/domain/forecast.ts) is BELOW
 *   the reorder lead days (setting reorderLeadDays): an order placed today would arrive after the stock runs out.
 *   Equal is not low; an item with no recent sales (cover null) never alerts. Cover 0 is high, otherwise medium.
 *
 * The input is an object of optional parts so later rules (stock cover, Task 13b) add fields without breaking callers.
 */

export const SALES_DROP_RATIO = '0.7'
export const SALES_DROP_TRAILING_DAYS = 7
export const SALES_DROP_MIN_ACTIVE_DAYS = 3
export const ODD_PRICE_RATIO = '0.5'
export const ODD_PRICE_WINDOW_DAYS = 7
export const OVERDUE_HIGH_DAYS = 30

export const ALERT_KINDS = ['lowStock', 'overdueDebt', 'salesDrop', 'oddPrice', 'lowCover'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]
export type AlertSeverity = 'high' | 'medium'
export type AlertMessageKey = `alert.${AlertKind}`

export type AlertRefs = { itemId?: string; customerId?: string; saleId?: string; saleLineId?: string; openingDebtId?: string }

export type Alert = {
  kind: AlertKind
  severity: AlertSeverity
  messageKey: AlertMessageKey
  refs: AlertRefs
  /** Values for the message placeholders, as plain decimal strings (formatting is the page's job). */
  params: Record<string, string>
}

export type StockAlertRow = { itemId: string; onHandBase: Decimal; reorderPoint: Decimal | null }
export type ReceivableAlertRow = { id: string; kind: 'SALE' | 'OPENING'; customerId: string; dueDate: string | null; openIqd: Decimal }
export type SalesAlertRow = { today: Decimal; trailing: Decimal[] }
/** `reorderBy` = the forecast's last order date (YYYY-MM-DD), passed through to the message. */
export type CoverAlertRow = { itemId: string; coverDays: number | null; reorderBy: string | null }
export type PriceAlertRow = { saleId: string; saleLineId: string; itemId: string; date: string; currency: Currency; officialPrice: Decimal; finalPrice: Decimal }

export type AlertInput = {
  /** Asia/Baghdad calendar date, YYYY-MM-DD. */
  today: string
  stock?: StockAlertRow[]
  receivables?: ReceivableAlertRow[]
  /** `trailing` = net sales of each of the previous SALES_DROP_TRAILING_DAYS days (not today). */
  sales?: SalesAlertRow
  prices?: PriceAlertRow[]
  /** Days of cover per item (all warehouses) and the reorder lead days they are compared with. */
  cover?: { leadDays: number; rows: CoverAlertRow[] }
}

const DAY_MS = 86_400_000
const dayNumber = (iso: string): number => Math.round(new Date(`${iso}T00:00:00Z`).getTime() / DAY_MS)
const str = (v: Decimal): string => new D(v).toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed()
const pct = (part: Decimal, whole: Decimal): string => new D(part).div(whole).times(100).toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed()

const make = (kind: AlertKind, severity: AlertSeverity, refs: AlertRefs, params: Record<string, string>): Alert => ({ kind, severity, messageKey: `alert.${kind}`, refs, params })

function lowStock(rows: StockAlertRow[]): Alert[] {
  return rows
    .filter((r) => r.reorderPoint !== null && new D(r.onHandBase).lt(r.reorderPoint))
    .map((r) => make('lowStock', new D(r.onHandBase).lte(0) ? 'high' : 'medium', { itemId: r.itemId }, { onHand: str(r.onHandBase), reorderPoint: str(r.reorderPoint!) }))
}

function overdue(rows: ReceivableAlertRow[], today: string): Alert[] {
  const t = dayNumber(today)
  return rows
    .filter((r) => r.dueDate !== null && r.dueDate < today && new D(r.openIqd).gt(0))
    .map((r) => {
      const days = t - dayNumber(r.dueDate!)
      const refs: AlertRefs = r.kind === 'SALE' ? { customerId: r.customerId, saleId: r.id } : { customerId: r.customerId, openingDebtId: r.id }
      return make('overdueDebt', days > OVERDUE_HIGH_DAYS ? 'high' : 'medium', refs, { dueDate: r.dueDate!, daysOverdue: String(days), openIqd: str(r.openIqd) })
    })
}

function salesDrop(s: SalesAlertRow): Alert[] {
  if (s.trailing.length < SALES_DROP_TRAILING_DAYS) return []
  const days = s.trailing.slice(-SALES_DROP_TRAILING_DAYS)
  if (days.filter((v) => new D(v).gt(0)).length < SALES_DROP_MIN_ACTIVE_DAYS) return []
  const average = days.reduce((a, v) => a.plus(v), new D(0)).div(SALES_DROP_TRAILING_DAYS)
  if (!average.gt(0) || !new D(s.today).lt(average.times(SALES_DROP_RATIO))) return []
  return [make('salesDrop', 'medium', {}, { today: str(s.today), average: str(average), percent: pct(s.today, average) })]
}

function oddPrices(rows: PriceAlertRow[], today: string): Alert[] {
  const t = dayNumber(today)
  return rows
    .filter((r) => {
      const age = t - dayNumber(r.date)
      return age >= 0 && age < ODD_PRICE_WINDOW_DAYS && new D(r.officialPrice).gt(0) && new D(r.finalPrice).lt(new D(r.officialPrice).times(ODD_PRICE_RATIO))
    })
    .map((r) =>
      make('oddPrice', 'medium', { saleId: r.saleId, saleLineId: r.saleLineId, itemId: r.itemId }, {
        officialPrice: str(r.officialPrice),
        finalPrice: str(r.finalPrice),
        currency: r.currency,
        percent: pct(r.finalPrice, r.officialPrice),
      }),
    )
}

function lowCover(c: { leadDays: number; rows: CoverAlertRow[] }): Alert[] {
  return c.rows
    .filter((r) => r.coverDays !== null && r.coverDays < c.leadDays)
    .map((r) => make('lowCover', r.coverDays === 0 ? 'high' : 'medium', { itemId: r.itemId }, { coverDays: String(r.coverDays), leadDays: String(c.leadDays), reorderBy: r.reorderBy ?? '' }))
}

/** Every alert the rules raise, high severity first, then in rule order (stable within a rule). */
export function computeAlerts(input: AlertInput): Alert[] {
  const all = [
    ...lowStock(input.stock ?? []),
    ...overdue(input.receivables ?? [], input.today),
    ...(input.sales ? salesDrop(input.sales) : []),
    ...oddPrices(input.prices ?? [], input.today),
    ...(input.cover ? lowCover(input.cover) : []),
  ]
  const rank = (a: Alert) => (a.severity === 'high' ? 0 : 1)
  return all.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map((x) => x.a)
}
