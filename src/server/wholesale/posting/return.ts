import { randomUUID } from 'node:crypto'
import type Decimal from 'decimal.js'
import type { ScopedTx } from '@/server/data/tenant-db'
import { QTY_DP } from '@/server/domain/wholesale/costing'
import type { LineInput } from '@/server/domain/wholesale/ledger'
import { D } from '@/server/domain/wholesale/money'
import { canWh } from '@/server/domain/wholesale/permissions'
import type { WhRole } from '@/server/domain/wholesale/permissions'
import { round4, snapshotRate } from '@/server/domain/wholesale/purchase'
import { baghdadDate, isIsoDate, type Currency } from '@/server/domain/wholesale/rates'
import { InvalidSaleError, ReturnQtyExceededError, SaleStateError, parseSaleAmount, saleTotals } from '@/server/domain/wholesale/sale'
import { assertNotFuture } from '@/server/wholesale/clock'
import { postJournal } from '@/server/wholesale/ledger'
import { assertPeriodOpen } from '@/server/wholesale/period'
import { lockSale, postSaleTx, saleOpen, type CreditWarning, type SaleLineInput } from '@/server/wholesale/posting/sale'
import { lockStockRows, receiveStock } from '@/server/wholesale/stock'
import { warehouseOfKind } from '@/server/wholesale/warehouses'

export { ReturnQtyExceededError } from '@/server/domain/wholesale/sale'

/*
 * Returns and exchanges against a POSTED sale (sale:return: OWNER/PARTNER; a REP may not). One transaction:
 * validate -> lock customer + sale (lockSale) -> read what was already returned -> period open -> stock locks for
 * every pair the return AND the exchange touch (one ordered lockStockRows) -> stock back -> exchange sale
 * (postSaleTx, same customer, currency and warehouse) -> journal -> rows -> audit. Any failure rolls everything back,
 * including the exchange sale.
 *
 * Quantities and value:
 * - qty is in the sale line's unit (qtyBase = qty x the line's own qtyBase/qty). Every return of a line counts:
 *   the sum never exceeds what the line sold (ReturnQtyExceededError; a DB trigger refuses it too). The sale row
 *   lock serialises two returns of one sale, so they cannot both pass.
 * - Value at the sale's own prices: this part's lineTotal = round4(returnedSoFar+qty) x finalPrice) -
 *   round4(returnedSoFar x finalPrice) (cumulative, so the returns of a line add up exactly to its lineTotal); the
 *   same for lineOfficial. The line discount is prorated that way; a sale has no invoice-level discount.
 * - All revenue/refund lines are in the sale currency at the sale's locked rate (rateSnapshot, pinned on the journal
 *   lines), so no rate row is needed for any day: the return reverses the sale's own valuation.
 *
 * Stock:
 * - GOOD goes back into the sale's warehouse, DAMAGED into the DAMAGE warehouse, both at the sale line's ORIGINAL
 *   issue cost (receiveStock at SaleLine.unitCostIqd), like cancelSale.
 * - Expiry: each returned quantity is taken from the line's SaleLineBatch portions not yet returned, OLDEST expiry
 *   first (no expiry last), the order the stock was issued in. Ruling: we cannot know which units the customer
 *   brings back; assuming the shortest shelf life never overstates it (expiry alerts come early, not late). Each
 *   portion is recorded (SaleReturnLineBatch) and a DB trigger keeps every (line, expiry) within what it took.
 *
 * Journal (one entry, source SALE_RETURN):
 * - DR SALES (official value, or final for premium lines), CR SALES_DISCOUNT (the prorated positive discount): the
 *   mirror of postSale's split (saleTotals on the returned parts).
 * - refund CASH: CR CASH_<currency> for the return value. With an exchange, the new sale is a CASH sale (DR CASH for
 *   its total), so the cash box nets to the settlement.
 * - refund DEBT_OFFSET: CR AR (party = the customer) for the return value, allocated to open credit sales of this
 *   transaction: first the returned sale itself (at its locked rate, no FX), then the exchange's new sale (a CREDIT
 *   sale; at ITS locked rate, the IQD difference to FX_LOSS / FX_GAIN, as a customer payment would). What cannot be
 *   allocated is refused (InvalidSaleError): the model has no customer credit balance, so a cash sale's return without
 *   an exchange, or one above the open debt, must be refunded in cash. Each allocation is a SaleReturnOffset row and
 *   reduces that sale's open balance (receivables, getSale, customer statement).
 * - Cost, IQD: DR INVENTORY / CR COGS for every returned part at its original cost (round4 of the sum); for the
 *   DAMAGED part also DR DAMAGE_LOSS / CR INVENTORY. So INVENTORY moves by the GOOD value only, which is what the
 *   main/rep warehouses gain; the DAMAGE warehouse's stock is carried at cost for reporting but written off in the
 *   ledger (INVENTORY = the value of every non-DAMAGE warehouse).
 *
 * Settlement = exchange total - return value (sale currency): > 0 CUSTOMER_PAYS, < 0 COMPANY_PAYS, 0 NONE. A plain
 * return is COMPANY_PAYS the return value. Dates: today (Asia/Baghdad) unless an OWNER/PARTNER (sale:price-override,
 * the sale back-date rule) passes `date`; never before the sale's date; the month must be open. Lock order: Customer
 * -> Sale -> Item (share) -> StockBalance, the same as sales.
 */

type Db = ScopedTx
type WhUser = { id: string; role: WhRole }
type DD = InstanceType<typeof D>
type Dec = Decimal | string

const MAX_LINES = 500
const QTY_MAX = new D(10).pow(24 - QTY_DP)
const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`)
const isoOf = (d: Date): string => d.toISOString().slice(0, 10)
const dec = (v: { toString(): string }): DD => new D(v.toString())
const sum = (xs: DD[]): DD => xs.reduce((a, b) => a.plus(b), new D(0))

export const RETURN_CONDITIONS = ['GOOD', 'DAMAGED'] as const
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number]
export const REFUND_MODES = ['CASH', 'DEBT_OFFSET'] as const
export type RefundMode = (typeof REFUND_MODES)[number]
export type SettlementDirection = 'CUSTOMER_PAYS' | 'COMPANY_PAYS' | 'NONE'

export type ReturnLineInput = { saleLineId: string; qty: Dec; condition: ReturnCondition }
export type ReturnInput = {
  saleId: string
  lines: ReturnLineInput[]
  refund: RefundMode
  exchange?: { lines: SaleLineInput[] } | null
  /** OWNER/PARTNER only (the sale back-date rule); default and for everyone else: today, Asia/Baghdad. */
  date?: string | null
}
export type Settlement = { direction: SettlementDirection; amount: Decimal; currency: Currency }
export type PostReturnResult = { returnId: string; settlement: Settlement; exchangeSaleId?: string; warning?: CreditWarning }

type Portion = { expiry: string | null; qtyBase: DD }

function requireId(v: unknown, label: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new InvalidSaleError(`${label} is required`)
  return v.trim()
}

function cleanInput(input: ReturnInput) {
  if (!input || typeof input !== 'object') throw new InvalidSaleError('return is required')
  const saleId = requireId(input.saleId, 'sale')
  if (!(REFUND_MODES as readonly string[]).includes(input.refund)) throw new InvalidSaleError(`unknown refund mode: ${String(input.refund)}`)
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new InvalidSaleError('a return needs at least one line')
  if (input.lines.length > MAX_LINES) throw new InvalidSaleError(`a return has at most ${MAX_LINES} lines`)
  const lines = input.lines.map((l, i) => {
    const at = `return line ${i + 1}`
    if (!l || typeof l !== 'object') throw new InvalidSaleError(`${at}: not a line`)
    if (!(RETURN_CONDITIONS as readonly string[]).includes(l.condition)) throw new InvalidSaleError(`${at}: unknown condition ${String(l.condition)}`)
    return {
      at,
      saleLineId: requireId(l.saleLineId, `${at}: sale line`),
      condition: l.condition,
      qty: parseSaleAmount(l.qty, { label: `${at}: quantity`, dp: QTY_DP, min: 'positive', max: QTY_MAX }),
    }
  })
  let exchange: SaleLineInput[] | null = null
  if (input.exchange !== undefined && input.exchange !== null) {
    if (typeof input.exchange !== 'object' || !Array.isArray(input.exchange.lines) || input.exchange.lines.length === 0)
      throw new InvalidSaleError('an exchange needs at least one new line')
    exchange = input.exchange.lines
  }
  return { saleId, refund: input.refund, lines, exchange }
}

/** postReturn inside the caller's transaction. */
export async function postReturnTx(tx: Db, rid: string, user: WhUser, input: ReturnInput): Promise<PostReturnResult> {
  const inp = cleanInput(input)
  let date = baghdadDate()
  if (input.date !== undefined && input.date !== null && input.date !== '' && canWh(user.role, 'sale.override')) {
    if (!isIsoDate(input.date)) throw new InvalidSaleError('date must be a date (YYYY-MM-DD)')
    date = input.date
    assertNotFuture(date)
  }

  // customer, then sale (FOR NO KEY UPDATE): concurrent returns, payments and cancellations of this sale wait here,
  // so what was already returned (read below) cannot change until this transaction ends
  const s = await lockSale(tx, rid, inp.saleId)
  if (s.status !== 'POSTED') throw new SaleStateError(`only a posted sale can be returned (this one is ${s.status.toLowerCase()})`)
  if (date < isoOf(s.date)) throw new InvalidSaleError('a return cannot be dated before its sale')
  await assertPeriodOpen(tx, rid, date)
  const customer = await tx.whCustomer.findUniqueOrThrow({ where: { id: s.customerId }, select: { id: true, name: true } })
  const rate = snapshotRate(s.rateSnapshot, s.currency)
  const pin = (c: Currency, r: DD) => (c === 'IQD' ? {} : { rateIqd: r })
  const damage = await warehouseOfKind(tx, rid, 'DAMAGE')

  // what every line of this sale has already given back, in total and per expiry portion
  const earlier = await tx.whSaleReturnLine.findMany({ where: { saleLine: { saleId: s.id } }, select: { saleLineId: true, qty: true, qtyBase: true, batches: { select: { expiry: true, qtyBase: true } } } })
  const lineById = new Map(s.lines.map((l) => [l.id, l]))
  const returnedQty = new Map<string, DD>()
  const returnedBase = new Map<string, DD>()
  const remainingPortions = new Map<string, Portion[]>()
  for (const l of s.lines) {
    const portions: Portion[] = l.batches.length
      ? l.batches.map((b) => ({ expiry: b.expiry ? isoOf(b.expiry) : null, qtyBase: dec(b.qtyBase) }))
      : [{ expiry: null, qtyBase: dec(l.qtyBase) }]
    // oldest expiry first, no expiry last (the issue order)
    portions.sort((a, b) => (a.expiry === b.expiry ? 0 : a.expiry === null ? 1 : b.expiry === null ? -1 : a.expiry < b.expiry ? -1 : 1))
    remainingPortions.set(l.id, portions)
    returnedQty.set(l.id, new D(0))
    returnedBase.set(l.id, new D(0))
  }
  for (const e of earlier) {
    returnedQty.set(e.saleLineId, returnedQty.get(e.saleLineId)!.plus(dec(e.qty)))
    returnedBase.set(e.saleLineId, returnedBase.get(e.saleLineId)!.plus(dec(e.qtyBase)))
    const portions = remainingPortions.get(e.saleLineId)!
    for (const b of e.batches) {
      const exp = b.expiry ? isoOf(b.expiry) : null
      const p = portions.find((x) => x.expiry === exp)
      if (!p) throw new Error(`sale ${s.id}: a return took expiry ${exp} that line ${e.saleLineId} never took`)
      p.qtyBase = p.qtyBase.minus(dec(b.qtyBase))
    }
  }

  const lines = inp.lines.map((r) => {
    const l = lineById.get(r.saleLineId)
    if (!l) throw new InvalidSaleError(`${r.at}: not a line of this sale`)
    if (l.unitCostIqd === null) throw new Error(`sale ${s.id} line ${l.lineNo}: posted without a cost`)
    const sold = dec(l.qty)
    const before = returnedQty.get(l.id)!
    const after = before.plus(r.qty)
    if (after.gt(sold)) throw new ReturnQtyExceededError(l.id, sold.minus(before), r.qty)
    returnedQty.set(l.id, after)
    // the line's own unit factor (qtyBase / qty); the last part is exactly what is left, so the parts sum to qtyBase
    const baseBefore = returnedBase.get(l.id)!
    const qtyBase = after.eq(sold) ? dec(l.qtyBase).minus(baseBefore) : r.qty.times(dec(l.qtyBase)).div(sold)
    if (!qtyBase.gt(0) || baseBefore.plus(qtyBase).gt(dec(l.qtyBase))) throw new ReturnQtyExceededError(l.id, sold.minus(before), r.qty)
    returnedBase.set(l.id, baseBefore.plus(qtyBase))
    if (qtyBase.decimalPlaces() > QTY_DP) throw new InvalidSaleError(`${r.at}: quantity in the base unit has more than ${QTY_DP} decimal places`)
    const cum = (q: DD, price: DD) => round4(q.times(price))
    const lineTotal = cum(after, dec(l.finalPrice)).minus(cum(before, dec(l.finalPrice)))
    const lineOfficial = cum(after, dec(l.officialPrice)).minus(cum(before, dec(l.officialPrice)))
    if (!lineTotal.gt(0)) throw new InvalidSaleError(`${r.at}: the returned quantity is worth less than 0.0001`)
    // take from the remaining expiry portions, oldest first
    const taken: Portion[] = []
    let left = qtyBase
    for (const p of remainingPortions.get(l.id)!) {
      if (left.isZero()) break
      const take = D.min(p.qtyBase, left)
      if (!take.gt(0)) continue
      p.qtyBase = p.qtyBase.minus(take)
      taken.push({ expiry: p.expiry, qtyBase: take })
      left = left.minus(take)
    }
    if (!left.isZero()) throw new Error(`sale ${s.id} line ${l.lineNo}: batch portions do not cover the returnable quantity`)
    return {
      ...r,
      line: l,
      qtyBase,
      unitCost: dec(l.unitCostIqd),
      lineTotal,
      lineOfficial,
      taken,
      warehouseId: r.condition === 'GOOD' ? s.warehouseId : damage.id,
    }
  })

  const t = saleTotals(lines)
  const value = t.totalFinal
  const costOf = (xs: typeof lines) => round4(sum(xs.map((l) => l.qtyBase.times(l.unitCost))))
  const goodCost = costOf(lines.filter((l) => l.condition === 'GOOD'))
  const damagedCost = costOf(lines.filter((l) => l.condition === 'DAMAGED'))
  const returnId = randomUUID()

  // one ordered lock over everything this transaction touches: the return's pairs and the exchange's
  const exchangeItemIds = (inp.exchange ?? []).map((l) => (l && typeof l === 'object' ? l.itemId : null)).filter((x): x is string => typeof x === 'string' && x !== '')
  const knownExchangeItems = exchangeItemIds.length ? (await tx.whItem.findMany({ where: { id: { in: exchangeItemIds } }, select: { id: true } })).map((i) => i.id) : []
  await lockStockRows(tx, rid, [
    ...lines.map((l) => ({ itemId: l.line.itemId, warehouseId: l.warehouseId })),
    ...knownExchangeItems.map((itemId) => ({ itemId, warehouseId: s.warehouseId })),
  ])

  // the goods come back first, so a GOOD return can be sold again in the exchange
  const ref = { type: 'SALE_RETURN', id: returnId }
  for (const l of lines)
    for (const p of l.taken) await receiveStock(tx, { restaurantId: rid, itemId: l.line.itemId, warehouseId: l.warehouseId, qtyBase: p.qtyBase, unitCostIqd: l.unitCost, expiry: p.expiry, ref, user })

  // the exchange: a normal sale of the new goods, same customer, currency and warehouse, dated with the return
  let exchange: { id: string; total: DD; rate: DD; warning?: CreditWarning } | null = null
  if (inp.exchange) {
    const r = await postSaleTx(
      tx,
      rid,
      user,
      { customerId: s.customerId, date, currency: s.currency, paymentMode: inp.refund === 'CASH' ? 'CASH' : 'CREDIT', warehouseId: s.warehouseId, lines: inp.exchange },
      inp.refund === 'DEBT_OFFSET' ? { creditRelief: { amount: value, rateIqd: rate } } : {},
    )
    // only a REP's price override is ever held, and a REP cannot return
    if (r.status !== 'POSTED') throw new Error('an exchange sale was held for approval')
    const ex = await tx.whSale.findUniqueOrThrow({ where: { id: r.saleId }, select: { totalFinal: true, rateSnapshot: true } })
    exchange = { id: r.saleId, total: dec(ex.totalFinal), rate: snapshotRate(ex.rateSnapshot, s.currency), warning: r.warning }
  }

  // the refund side
  const journal: LineInput[] = []
  const offsets: { saleId: string; amount: DD; rateIqd: DD; fxDiffIqd: DD }[] = []
  if (inp.refund === 'CASH') {
    journal.push({ accountCode: `CASH_${s.currency}`, side: 'CR', amount: value, currency: s.currency, ...pin(s.currency, rate) })
  } else {
    let left = value
    const own = s.paymentMode === 'CREDIT' ? D.min(left, await saleOpen(tx, rid, s.customerId, s.id)) : new D(0)
    if (own.gt(0)) {
      offsets.push({ saleId: s.id, amount: own, rateIqd: rate, fxDiffIqd: new D(0) })
      left = left.minus(own)
    }
    if (left.gt(0) && exchange) {
      const onNew = D.min(left, exchange.total)
      const fx = round4(onNew.times(exchange.rate)).minus(round4(onNew.times(rate)))
      offsets.push({ saleId: exchange.id, amount: onNew, rateIqd: exchange.rate, fxDiffIqd: fx })
      left = left.minus(onNew)
    }
    if (left.gt(0))
      throw new InvalidSaleError(
        s.paymentMode === 'CREDIT' || exchange
          ? `the customer owes only ${value.minus(left).toFixed()} ${s.currency} that this return can offset: refund the rest in cash`
          : 'a cash sale has no debt to offset: refund in cash',
      )
    for (const o of offsets)
      journal.push({ accountCode: 'AR', side: 'CR', amount: o.amount, currency: s.currency, partyId: s.customerId, ...pin(s.currency, o.rateIqd) })
    const fx = sum(offsets.map((o) => o.fxDiffIqd))
    // positive: AR was credited with more IQD than the returned goods are worth at the sale's rate -> loss
    if (fx.gt(0)) journal.push({ accountCode: 'FX_LOSS', side: 'DR', amount: fx, currency: 'IQD' })
    if (fx.lt(0)) journal.push({ accountCode: 'FX_GAIN', side: 'CR', amount: fx.abs(), currency: 'IQD' })
  }
  // the revenue side: the mirror of the sale's split
  journal.push({ accountCode: 'SALES', side: 'DR', amount: t.salesCredit, currency: s.currency, ...pin(s.currency, rate) })
  if (t.discountDebit.gt(0)) journal.push({ accountCode: 'SALES_DISCOUNT', side: 'CR', amount: t.discountDebit, currency: s.currency, ...pin(s.currency, rate) })
  // the cost side: every part back to stock at cost, the damaged part written off
  const cost = goodCost.plus(damagedCost)
  if (cost.gt(0)) {
    journal.push({ accountCode: 'INVENTORY', side: 'DR', amount: cost, currency: 'IQD' })
    journal.push({ accountCode: 'COGS', side: 'CR', amount: cost, currency: 'IQD' })
  }
  if (damagedCost.gt(0)) {
    journal.push({ accountCode: 'DAMAGE_LOSS', side: 'DR', amount: damagedCost, currency: 'IQD' })
    journal.push({ accountCode: 'INVENTORY', side: 'CR', amount: damagedCost, currency: 'IQD' })
  }
  const { entryId } = await postJournal(tx, rid, { date, memo: `Return of sale ${s.number.toString()} from ${customer.name}`, source: ref, user, lines: journal })

  const diff = exchange ? exchange.total.minus(value) : value.neg()
  const settlement: Settlement = { direction: diff.gt(0) ? 'CUSTOMER_PAYS' : diff.lt(0) ? 'COMPANY_PAYS' : 'NONE', amount: diff.abs(), currency: s.currency }

  await tx.whSaleReturn.create({
    data: {
      id: returnId,
      saleId: s.id,
      date: toDbDate(date),
      currency: s.currency,
      refund: inp.refund,
      totalValue: value.toFixed(),
      totalOfficial: t.totalOfficial.toFixed(),
      totalCostIqd: cost.toFixed(),
      damageLossIqd: damagedCost.toFixed(),
      exchangeSaleId: exchange?.id ?? null,
      settlementDirection: settlement.direction,
      settlementAmount: settlement.amount.toFixed(),
      journalEntryId: entryId,
      restaurantId: rid,
      userId: user.id,
      lines: {
        create: lines.map((l, i) => ({
          restaurantId: rid,
          lineNo: i + 1,
          saleLineId: l.line.id,
          condition: l.condition,
          warehouseId: l.warehouseId,
          qty: l.qty.toFixed(),
          qtyBase: l.qtyBase.toFixed(),
          unitCostIqd: l.unitCost.toFixed(),
          lineOfficial: l.lineOfficial.toFixed(),
          lineTotal: l.lineTotal.toFixed(),
          batches: { create: l.taken.map((p) => ({ restaurantId: rid, expiry: p.expiry ? toDbDate(p.expiry) : null, qtyBase: p.qtyBase.toFixed() })) },
        })),
      },
      offsets: { create: offsets.map((o) => ({ restaurantId: rid, saleId: o.saleId, amount: o.amount.toFixed(), rateIqd: o.rateIqd.toFixed(), fxDiffIqd: o.fxDiffIqd.toFixed() })) },
    },
    select: { number: true },
  })
  return {
    returnId,
    settlement,
    ...(exchange ? { exchangeSaleId: exchange.id } : {}),
    ...(exchange?.warning ? { warning: exchange.warning } : {}),
  }
}

