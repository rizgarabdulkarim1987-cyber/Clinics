/* eslint-disable no-restricted-properties -- row locks and sums of one company: every statement binds "restaurantId" (the company's own id) */
import { randomUUID } from 'node:crypto'
import type Decimal from 'decimal.js'
import type { Prisma } from '@/generated/prisma/client'
import type { ScopedTx } from '@/server/data/tenant-db'
import { isUnit, type Names, type Unit } from '@/server/domain/wholesale/catalog'
import { QTY_DP } from '@/server/domain/wholesale/costing'
import { AMOUNT_DP, type LineInput } from '@/server/domain/wholesale/ledger'
import { D } from '@/server/domain/wholesale/money'
import { ForbiddenError, canWh } from '@/server/domain/wholesale/permissions'
import type { WhRole } from '@/server/domain/wholesale/permissions'
import { MissingUnitError, toBase } from '@/server/domain/wholesale/pricing'
import { InvalidPurchaseError, isCurrency, isPaymentMode, round4, settlePayment, snapshotOf, snapshotRate, type OpenDoc, type PaymentMode } from '@/server/domain/wholesale/purchase'
import { RateMissingError, baghdadDate, isIsoDate, type Currency, type PartialRates } from '@/server/domain/wholesale/rates'
import {
  CreditLimitExceededError,
  InvalidSaleError,
  SaleStateError,
  exposureIqd,
  isPriceMode,
  parsePercent,
  parseSaleAmount,
  priceSaleLine,
  saleTotals,
  type PriceMode,
  type PricedSaleLine,
} from '@/server/domain/wholesale/sale'
import { assertNotFuture } from '@/server/wholesale/clock'
import { postJournal, reverseJournal } from '@/server/wholesale/ledger'
import { assertPeriodOpen } from '@/server/wholesale/period'
import { lockCustody, requireAvailableCustody } from '@/server/wholesale/posting/custody'
import { requireRates } from '@/server/wholesale/rates'
import { getSetting } from '@/server/wholesale/settings'
import { issueStock, lockStockRows, receiveStock, type IssuedPortion } from '@/server/wholesale/stock'

export { CreditLimitExceededError, InvalidSaleError, SaleStateError } from '@/server/domain/wholesale/sale'
export { OverpaymentError } from '@/server/domain/wholesale/purchase'

/*
 * Sales, approval, cancellation, customer payments, customer statement.
 *
 * Every write runs in ONE transaction (the exported functions open it with withTx; the *Tx variants join the
 * caller's): validate -> period open -> rates -> customer lock + credit check -> stock locks -> issue -> journal ->
 * document rows -> audit. Any failure rolls everything back, so nothing is ever partly saved.
 *
 * Who may sell what (enforced here, re-checked by the form actions):
 * - sale:create. A user without catalog:edit (a REP) only sells to customers whose repId is their own user id, and
 *   receives payments only from them; anyone else gets ForbiddenError. OWNER/PARTNER sell to any customer.
 * - A user without stock:edit (a REP) only sells from the REP warehouse whose repUserId is their own user id (the
 *   session's warehouseId is not trusted for this). OWNER/PARTNER sell from any warehouse except DAMAGE; nobody sells
 *   from DAMAGE (InvalidSaleError).
 * - Price override (PERCENT or MANUAL) by a user without sale:price-override (a REP) while the setting
 *   requireApproval is on: the sale is saved PENDING_APPROVAL and NOTHING is posted (no stock, ledger or credit
 *   effect) until approveSale (sale:approve) posts it at the approval day's date and rates. OWNER/PARTNER are never held.
 * - Cost (totalCostIqd, unitCostIqd) is only ever returned to users with cost:view.
 *
 * Money rules:
 * - Prices: the IQD price list price per unit is converted to the sale currency at the day's rates (4 dp); PERCENT
 *   takes the percent off that (4 dp), MANUAL is the entered price in the sale currency (> 0; above the list price is
 *   a premium). Each line keeps official, final and discount per unit; lineTotal = qty x final (4 dp).
 * - Journal: DR CASH_<currency> (a REP's cash sale: DR REP_CUSTODY, party = the rep) or DR AR (party = the customer)
 *   for the total; CR SALES with the official amount of every line sold at or below the list price and the final
 *   amount of premium lines; DR SALES_DISCOUNT with the positive discounts; DR COGS / CR INVENTORY in IQD with
 *   sum(qtyBase x the average cost the stock engine issued at), rounded once to 4 dp. Foreign lines use the sale
 *   day's rate (locked in rateSnapshot); the sub-fils residue goes to ROUNDING by the ledger's own rule.
 * - AR stays in the sale currency per customer (partyId). Open balances are per credit sale, derived as
 *   totalFinal - sum(CustomerPayment.settledInSaleCcy) - sum(SaleReturnOffset.amount) (returns credited to the debt,
 *   posting/return.ts). A customer's opening debts (OpeningDebt, import/opening.ts) are open documents too, at their
 *   pinned rate: FIFO payments (no saleId) settle them first, and the credit limit counts them. A payment credits AR
 *   at the document's locked rate (pinned line
 *   rate) and debits cash / custody at the payment day's rate; the IQD difference goes to FX_GAIN (the customer paid
 *   more IQD value than AR carried) or FX_LOSS.
 * - Credit limit (customer.creditLimitIqd, when set; CREDIT sales only): open receivable at the sale day's rates plus
 *   this sale, in IQD. Above the limit: setting creditLimitMode WARN posts and returns { warning }, BLOCK throws
 *   CreditLimitExceededError. Pending sales do not count.
 *
 * Lock order (no cycles): Customer row -> Sale row -> Item rows (share) -> StockBalance rows (lockStockRows).
 */

type Db = ScopedTx
type WhUser = { id: string; role: WhRole }
type DD = InstanceType<typeof D>
type Dec = Decimal | string

const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`)
const isoOf = (d: Date): string => d.toISOString().slice(0, 10)
const QTY_MAX = new D(10).pow(24 - QTY_DP)
const MAX_LINES = 500
const dec = (v: { toString(): string }): DD => new D(v.toString())
const sum = (xs: DD[]): DD => xs.reduce((a, b) => a.plus(b), new D(0))
const cashAccount = (c: Currency) => `CASH_${c}`

function requireDate(v: unknown, label: string): string {
  if (!isIsoDate(v)) throw new InvalidSaleError(`${label} must be a date (YYYY-MM-DD)`)
  return v
}

/**
 * The date a document is posted on. A user without sale:price-override (a REP) always posts on today's date
 * (Asia/Baghdad), whatever was sent: choosing another day would choose its exchange rate, an unapproved price change
 * on a USD/IRT document. OWNER/PARTNER may back-date (into an open month, checked by the posting) but never date in
 * the future (FutureDateError, server/clock.ts).
 */
function documentDate(user: WhUser, v: unknown): string {
  if (!canWh(user.role, 'sale.override')) return baghdadDate()
  const d = requireDate(v, 'date')
  assertNotFuture(d)
  return d
}

function requireId(v: unknown, label: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new InvalidSaleError(`${label} is required`)
  return v.trim()
}

function requireReason(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new InvalidSaleError('a reason is required')
  return v.trim()
}

/** SELECT ... FOR NO KEY UPDATE (see posting/purchase.ts lockRow); false when the row does not exist. */
async function lockRow(tx: Db, rid: string, table: 'Customer' | 'Sale', id: string): Promise<boolean> {
  const rows =
    table === 'Customer'
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "WhCustomer" WHERE id = ${id} AND "restaurantId" = ${rid} FOR NO KEY UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "WhSale" WHERE id = ${id} AND "restaurantId" = ${rid} FOR NO KEY UPDATE`
  return rows.length > 0
}

/** OWNER/PARTNER see every customer; anyone else (a REP) only their own. Same rule as catalog.customerScope. */
const seesAllCustomers = (user: WhUser) => canWh(user.role, 'catalog.manage')

/** The customer, if this user may deal with them: unknown -> InvalidSaleError, another rep's -> ForbiddenError. */
async function customerFor(db: Db, user: WhUser, id: string) {
  const c = await db.whCustomer.findUnique({ where: { id }, select: { id: true, name: true, active: true, repId: true, creditLimitIqd: true } })
  if (!c) throw new InvalidSaleError('unknown customer')
  if (!seesAllCustomers(user) && c.repId !== user.id) throw new ForbiddenError('customer:view-own')
  return c
}

/** The warehouse a user may sell from: never DAMAGE; a REP only their own (by Warehouse.repUserId). */
async function warehouseFor(db: Db, user: WhUser, id: string) {
  const w = await db.whWarehouse.findUnique({ where: { id }, select: { id: true, kind: true, repUserId: true } })
  if (!w) throw new InvalidSaleError('unknown warehouse')
  if (w.kind === 'DAMAGE') throw new InvalidSaleError('nothing is sold from the damage warehouse')
  if (!canWh(user.role, 'stock.transfer') && !(w.kind === 'REP' && w.repUserId === user.id)) throw new ForbiddenError('sale:create')
  return w
}

// ---------------------------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------------------------

export type SaleLineInput = { itemId: string; unit: Unit; qty: Dec; mode: PriceMode; percent?: Dec | null; manual?: Dec | null }
export type SaleInput = {
  customerId: string
  date: string
  currency: Currency
  paymentMode: PaymentMode
  warehouseId: string
  /** Credit sales only; on or after `date`. */
  dueDate?: string | null
  lines: SaleLineInput[]
}
export type CreditWarning = { exposureIqd: string; limitIqd: string }
export type PostSaleResult = { saleId: string; status: 'POSTED' | 'PENDING_APPROVAL'; warning?: CreditWarning }

type CleanLine = { itemId: string; unit: Unit; qty: DD; mode: PriceMode; percent: DD | null; manual: DD | null }

function cleanLines(input: SaleLineInput[]): CleanLine[] {
  if (!Array.isArray(input) || input.length === 0) throw new InvalidSaleError('a sale needs at least one line')
  if (input.length > MAX_LINES) throw new InvalidSaleError(`a sale has at most ${MAX_LINES} lines`)
  return input.map((l, i) => {
    const at = `line ${i + 1}`
    if (!l || typeof l !== 'object') throw new InvalidSaleError(`${at}: not a line`)
    const itemId = requireId(l.itemId, `${at}: item`)
    if (!isUnit(l.unit)) throw new InvalidSaleError(`${at}: unknown unit ${String(l.unit)}`)
    if (!isPriceMode(l.mode)) throw new InvalidSaleError(`${at}: unknown price mode ${String(l.mode)}`)
    const qty = parseSaleAmount(l.qty, { label: `${at}: quantity`, dp: QTY_DP, min: 'positive', max: QTY_MAX })
    const percent = l.mode === 'PERCENT' ? parsePercent(l.percent, `${at}: percent`) : null
    const manual = l.mode === 'MANUAL' ? parseSaleAmount(l.manual, { label: `${at}: manual price`, dp: AMOUNT_DP, min: 'positive' }) : null
    return { itemId, unit: l.unit, qty, mode: l.mode, percent, manual }
  })
}

type ItemInfo = { id: string; baseUnit: Unit; units: { unit: Unit; factorToBase: Prisma.Decimal }[]; prices: { unit: Unit; priceIqd: Prisma.Decimal }[] }

/** Items with units and prices; refuses unknown/archived items. Call after the stock rows are locked to read frozen units. */
async function loadItems(db: Db, itemIds: string[]): Promise<Map<string, ItemInfo & { active: boolean }>> {
  const items = await db.whItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, active: true, baseUnit: true, units: { select: { unit: true, factorToBase: true } }, prices: { select: { unit: true, priceIqd: true } } },
  })
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const id of itemIds) {
    const it = byId.get(id)
    if (!it) throw new InvalidSaleError(`unknown item: ${id}`)
    if (!it.active) throw new InvalidSaleError(`item is archived: ${id}`)
  }
  return byId
}

function qtyBaseOf(l: { qty: DD; unit: Unit }, item: ItemInfo, at: string): DD {
  let q: DD
  try {
    q = new D(toBase(l.qty, l.unit, item))
  } catch (e) {
    if (e instanceof MissingUnitError) throw new InvalidSaleError(`${at}: the item has no ${l.unit} unit`)
    throw e
  }
  if (q.decimalPlaces() > QTY_DP) throw new InvalidSaleError(`${at}: quantity in the base unit has more than ${QTY_DP} decimal places`)
  if (q.gte(QTY_MAX)) throw new InvalidSaleError(`${at}: quantity is too large`)
  return q
}

// ---------------------------------------------------------------------------------------------------------------
// Receivables and the credit check
// ---------------------------------------------------------------------------------------------------------------

/** `number` is null for an opening debt (kind OPENING). */
type Receivable = OpenDoc & { number: bigint | null; lockedRate: DD; date: string; dueDate: string | null; createdAt: Date; amount: DD }

/**
 * A customer's open documents with what is still open on each, FIFO-sorted (due date, then date, then entry order):
 * posted credit sales and, unless one sale is asked for, the customer's opening debts (import/opening.ts: dated the
 * opening date, so they come first).
 */
async function receivables(db: Db, rid: string, customerId: string, saleId?: string): Promise<Receivable[]> {
  const sales = await db.whSale.findMany({
    where: { customerId, paymentMode: 'CREDIT', status: 'POSTED', ...(saleId ? { id: saleId } : {}) },
    select: { id: true, number: true, currency: true, totalFinal: true, rateSnapshot: true, date: true, dueDate: true, createdAt: true },
  })
  const openings = saleId ? [] : await db.whOpeningDebt.findMany({ where: { customerId }, select: { id: true, currency: true, amount: true, rateIqd: true, date: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { lineNo: 'asc' }] })
  const ids = sales.map((s) => s.id)
  const paid = await db.whCustomerPayment.findMany({
    where: { OR: [{ saleId: { in: ids } }, { openingDebtId: { in: openings.map((o) => o.id) } }] },
    select: { saleId: true, openingDebtId: true, settledInSaleCcy: true },
  })
  const offsets = await db.whSaleReturnOffset.findMany({ where: { saleId: { in: ids } }, select: { saleId: true, amount: true } })
  const paidOf = (id: string) =>
    sum(paid.filter((r) => r.saleId === id || r.openingDebtId === id).map((r) => dec(r.settledInSaleCcy))).plus(
      sum(offsets.filter((r) => r.saleId === id).map((r) => dec(r.amount))),
    )
  const opening: Receivable[] = openings.map((o) => ({
    kind: 'OPENING' as const,
    id: o.id,
    number: null,
    currency: o.currency,
    amount: dec(o.amount),
    open: dec(o.amount).minus(paidOf(o.id)),
    lockedRate: dec(o.rateIqd),
    date: isoOf(o.date),
    dueDate: null,
    createdAt: o.createdAt,
  }))
  const docs: Receivable[] = [...opening, ...sales.map((s) => ({
    kind: 'SALE' as const,
    id: s.id,
    number: s.number,
    currency: s.currency,
    amount: dec(s.totalFinal),
    open: dec(s.totalFinal).minus(paidOf(s.id)),
    lockedRate: snapshotRate(s.rateSnapshot, s.currency),
    date: isoOf(s.date),
    dueDate: s.dueDate ? isoOf(s.dueDate) : null,
    createdAt: s.createdAt,
  }))]
  return docs.sort((a, b) => {
    const da = a.dueDate ?? a.date
    const db_ = b.dueDate ?? b.date
    return da < db_ ? -1 : da > db_ ? 1 : a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.getTime() - b.createdAt.getTime()
  })
}

/** What is still open on one posted credit sale of the customer (0 for a cash sale). Caller holds the customer lock. */
export async function saleOpen(db: Db, rid: string, customerId: string, saleId: string): Promise<DD> {
  const [r] = await receivables(db, rid, customerId, saleId)
  return r ? r.open : new D(0)
}

/** A known reduction of the exposure (a return credited to the debt in the same transaction), at its IQD rate. */
export type CreditRelief = { amount: DD; rateIqd: DD }

/**
 * Credit check for a CREDIT sale of `total` at `rate` (IQD per unit of the sale currency, the sale day's rate).
 * Caller holds the customer row lock. No limit set -> nothing. Exposure = every open credit sale at the rate it was
 * posted with (its locked rateSnapshot, already stored, so no other day's rate is ever needed: an all-IQD sale needs
 * no rate row even when the customer owes dollars) + this sale. Above the limit: BLOCK throws
 * CreditLimitExceededError, WARN returns the warning. `relief` (an exchange's return credited to the debt) is taken off.
 */
async function creditCheck(
  tx: Db,
  rid: string,
  customer: { id: string; creditLimitIqd: Prisma.Decimal | null },
  total: DD,
  rate: DD,
  relief?: CreditRelief,
): Promise<CreditWarning | undefined> {
  if (customer.creditLimitIqd === null) return undefined
  const limit = dec(customer.creditLimitIqd)
  const open = (await receivables(tx, rid, customer.id)).filter((x) => x.open.gt(0))
  const exposure = exposureIqd([
    ...open.map((x) => ({ open: x.open, rateIqd: x.lockedRate })),
    { open: total, rateIqd: rate },
    ...(relief ? [{ open: relief.amount.neg(), rateIqd: relief.rateIqd }] : []),
  ])
  if (!exposure.gt(limit)) return undefined
  if ((await getSetting(tx, 'creditLimitMode')) === 'BLOCK') throw new CreditLimitExceededError(exposure, limit)
  return { exposureIqd: exposure.toFixed(), limitIqd: limit.toFixed() }
}

// ---------------------------------------------------------------------------------------------------------------
// Posting (shared by postSale and approveSale)
// ---------------------------------------------------------------------------------------------------------------

type PostArgs = {
  saleId: string
  date: string
  currency: Currency
  paymentMode: PaymentMode
  /** IQD per unit of `currency` on `date` (1 for IQD). */
  rate: DD
  customer: { id: string; name: string; creditLimitIqd: Prisma.Decimal | null }
  warehouseId: string
  /** The rep whose custody receives a cash sale's money, or null (cash box). */
  custodyRepId: string | null
  lines: { itemId: string; qtyBase: DD }[]
  priced: PricedSaleLine[]
  user: WhUser
  creditRelief?: CreditRelief
}

/**
 * Credit check, stock out at the issued average, journal entry. Returns the entry, per line the issued unit cost and
 * the expiry-batch portions taken (stored as SaleLineBatch rows), and COGS.
 */
async function postCore(tx: Db, rid: string, a: PostArgs): Promise<{ entryId: string; costs: DD[]; batches: IssuedPortion[][]; cogsIqd: DD; warning?: CreditWarning }> {
  const t = saleTotals(a.priced)
  let warning: CreditWarning | undefined
  if (a.paymentMode === 'CREDIT') {
    // serialises credit sales and payments of one customer, so two sales cannot both pass the limit
    await lockRow(tx, rid, 'Customer', a.customer.id)
    warning = await creditCheck(tx, rid, a.customer, t.totalFinal, a.rate, a.creditRelief)
  }
  await lockStockRows(tx, rid, a.lines.map((l) => ({ itemId: l.itemId, warehouseId: a.warehouseId })))
  const ref = { type: 'SALE', id: a.saleId }
  const costs: DD[] = []
  const batches: IssuedPortion[][] = []
  for (const l of a.lines) {
    const r = await issueStock(tx, { restaurantId: rid, itemId: l.itemId, warehouseId: a.warehouseId, qtyBase: l.qtyBase, ref, user: a.user })
    costs.push(new D(r.unitCostIqd))
    batches.push(r.batches)
  }
  const cogsIqd = round4(sum(a.lines.map((l, i) => l.qtyBase.times(costs[i]))))

  const lines: LineInput[] = [
    a.paymentMode === 'CREDIT'
      ? { accountCode: 'AR', side: 'DR', amount: t.totalFinal, currency: a.currency, partyId: a.customer.id }
      : a.custodyRepId
        ? { accountCode: 'REP_CUSTODY', side: 'DR', amount: t.totalFinal, currency: a.currency, partyId: a.custodyRepId }
        : { accountCode: cashAccount(a.currency), side: 'DR', amount: t.totalFinal, currency: a.currency },
  ]
  if (t.discountDebit.gt(0)) lines.push({ accountCode: 'SALES_DISCOUNT', side: 'DR', amount: t.discountDebit, currency: a.currency })
  lines.push({ accountCode: 'SALES', side: 'CR', amount: t.salesCredit, currency: a.currency })
  if (cogsIqd.gt(0)) {
    lines.push({ accountCode: 'COGS', side: 'DR', amount: cogsIqd, currency: 'IQD' })
    lines.push({ accountCode: 'INVENTORY', side: 'CR', amount: cogsIqd, currency: 'IQD' })
  }
  const { entryId } = await postJournal(tx, rid, { date: a.date, memo: `Sale to ${a.customer.name}`, source: ref, user: a.user, lines })
  return { entryId, costs, batches, cogsIqd, warning }
}

const batchRows = (rid: string, portions: IssuedPortion[]) => portions.map((b) => ({ restaurantId: rid, expiry: b.expiry ? toDbDate(b.expiry) : null, qtyBase: new D(b.qtyBase).toFixed() }))
const rateOf = (rates: PartialRates, c: Currency): DD => (c === 'IQD' ? new D(1) : new D(rates.iqdPer[c]!))
const addDays = (date: string, days: number): string => isoOf(new Date(toDbDate(date).getTime() + days * 86_400_000))
const daysBetween = (from: string, to: string): number => Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000)

const lineRow = (p: PricedSaleLine) => ({
  officialPrice: p.officialPrice.toFixed(),
  finalPrice: p.finalPrice.toFixed(),
  discount: p.discount.toFixed(),
  lineTotal: p.lineTotal.toFixed(),
})

/** Internal options for a sale posted by another document in the same transaction (an exchange, posting/return.ts). */
export type PostSaleOptions = { creditRelief?: CreditRelief }

/** postSale inside the caller's transaction. */
export async function postSaleTx(tx: Db, rid: string, user: WhUser, input: SaleInput, opts: PostSaleOptions = {}): Promise<PostSaleResult> {
  if (!input || typeof input !== 'object') throw new InvalidSaleError('sale is required')
  const customer = await customerFor(tx, user, requireId(input.customerId, 'customer'))
  if (!customer.active) throw new InvalidSaleError('the customer is archived')
  const warehouse = await warehouseFor(tx, user, requireId(input.warehouseId, 'warehouse'))
  // A REP always sells on today's date; OWNER/PARTNER may back-date into an open month, never forward (documentDate).
  const date = documentDate(user, input.date)
  if (!isCurrency(input.currency)) throw new InvalidSaleError(`unknown currency: ${String(input.currency)}`)
  if (!isPaymentMode(input.paymentMode)) throw new InvalidSaleError(`unknown payment mode: ${String(input.paymentMode)}`)
  const dueDate = input.dueDate === undefined || input.dueDate === null || input.dueDate === '' ? null : requireDate(input.dueDate, 'due date')
  if (dueDate !== null && input.paymentMode !== 'CREDIT') throw new InvalidSaleError('only a credit sale has a due date')
  if (dueDate !== null && dueDate < date) throw new InvalidSaleError('the due date is before the sale date')
  const currency = input.currency
  const clean = cleanLines(input.lines)
  const itemIds = [...new Set(clean.map((l) => l.itemId))]
  const items = await loadItems(tx, itemIds)

  const held = clean.some((l) => l.mode !== 'OFFICIAL') && !canWh(user.role, 'sale.override') && (await getSetting(tx, 'requireApproval'))
  if (!held) await assertPeriodOpen(tx, rid, date)
  const rates = await requireRates(tx, date, [currency])
  const lines = clean.map((l, i) => {
    const at = `line ${i + 1}`
    const item = items.get(l.itemId)!
    const qtyBase = qtyBaseOf(l, item, at)
    const price = item.prices.find((p) => p.unit === l.unit)
    if (!price) throw new InvalidSaleError(`${at}: the item has no list price for ${l.unit}`)
    const officialPriceIqd = dec(price.priceIqd)
    return { ...l, qtyBase, officialPriceIqd, priced: priceSaleLine({ officialPriceIqd, qty: l.qty, mode: l.mode, percent: l.percent, manual: l.manual }, currency, rates, at) }
  })
  const t = saleTotals(lines.map((l) => l.priced))

  // the rep whose custody receives a rep's cash sale, stored on the sale (cancel/approve never look at the role again)
  const custodyRepId = input.paymentMode === 'CASH' && user.role === 'REP' ? user.id : null
  const saleId = randomUUID()
  let post: Awaited<ReturnType<typeof postCore>> | null = null
  if (!held)
    post = await postCore(tx, rid, {
      saleId,
      date,
      currency,
      paymentMode: input.paymentMode,
      rate: rateOf(rates, currency),
      customer,
      warehouseId: warehouse.id,
      custodyRepId,
      lines,
      priced: lines.map((l) => l.priced),
      user,
      creditRelief: opts.creditRelief,
    })
  // Every sale is inserted PENDING_APPROVAL with its lines (the DB only accepts lines into a pending sale), and a
  // posted one moves to POSTED right after, in this transaction.
  await tx.whSale.create({
    data: {
      id: saleId,
      restaurantId: rid,
      customerId: customer.id,
      date: toDbDate(date),
      currency,
      paymentMode: input.paymentMode,
      dueDate: dueDate ? toDbDate(dueDate) : null,
      warehouseId: warehouse.id,
      status: 'PENDING_APPROVAL',
      rateSnapshot: snapshotOf(rates, [currency]),
      totalOfficial: t.totalOfficial.toFixed(),
      totalFinal: t.totalFinal.toFixed(),
      totalDiscount: t.totalDiscount.toFixed(),
      userId: user.id,
      custodyRepId,
      lines: {
        create: lines.map((l, i) => ({
          restaurantId: rid,
          lineNo: i + 1,
          itemId: l.itemId,
          unit: l.unit,
          qty: l.qty.toFixed(),
          qtyBase: l.qtyBase.toFixed(),
          priceMode: l.mode,
          percent: l.percent?.toFixed() ?? null,
          manualPrice: l.manual?.toFixed() ?? null,
          officialPriceIqd: l.officialPriceIqd.toFixed(),
          ...lineRow(l.priced),
          unitCostIqd: post ? post.costs[i].toFixed() : null,
          ...(post ? { batches: { create: batchRows(rid, post.batches[i]) } } : {}),
        })),
      },
    },
    select: { number: true },
  })
  if (post) await tx.whSale.update({ where: { id: saleId }, data: { status: 'POSTED', totalCostIqd: post.cogsIqd.toFixed(), journalEntryId: post.entryId } })
  return { saleId, status: held ? 'PENDING_APPROVAL' : 'POSTED', ...(post?.warning ? { warning: post.warning } : {}) }
}

// ---------------------------------------------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------------------------------------------

/** Lock the sale's customer then the sale (the global lock order) and return the sale with its lines. */
export async function lockSale(tx: Db, rid: string, saleId: string) {
  const id = requireId(saleId, 'sale')
  const head = await tx.whSale.findUnique({ where: { id }, select: { customerId: true } })
  if (!head) throw new InvalidSaleError('unknown sale')
  await lockRow(tx, rid, 'Customer', head.customerId)
  await lockRow(tx, rid, 'Sale', id)
  return tx.whSale.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' }, include: { batches: true } } } })
}

/**
 * The rep whose custody holds a posted cash sale's money: Sale.custodyRepId (set when the sale is entered; backfilled
 * from the journal by the 20261106 migration). Safe fallback for a row without it: the party of the REP_CUSTODY debit
 * of the sale's own journal entry, i.e. where the money actually went. null = the office cash box.
 */
async function custodyRepOf(tx: Db, s: { custodyRepId: string | null; journalEntryId: string | null }): Promise<string | null> {
  if (s.custodyRepId) return s.custodyRepId
  if (!s.journalEntryId) return null
  const line = await tx.whJournalLine.findFirst({ where: { entryId: s.journalEntryId, side: 'DR', account: { code: 'REP_CUSTODY' } }, select: { partyId: true } })
  return line?.partyId ?? null
}

/** approveSale inside the caller's transaction. */
export async function approveSaleTx(tx: Db, rid: string, user: WhUser, saleId: string): Promise<{ warning?: CreditWarning }> {
  const s = await lockSale(tx, rid, saleId)
  if (s.status !== 'PENDING_APPROVAL') throw new SaleStateError(`the sale is ${s.status.toLowerCase()}, not waiting for approval`)
  const customer = await tx.whCustomer.findUniqueOrThrow({ where: { id: s.customerId }, select: { id: true, name: true, active: true, creditLimitIqd: true } })
  if (!customer.active) throw new InvalidSaleError('the customer is archived')
  const items = await loadItems(tx, [...new Set(s.lines.map((l) => l.itemId))])
  const date = baghdadDate()
  await assertPeriodOpen(tx, rid, date)
  const rates = await requireRates(tx, date, [s.currency])
  // No re-pricing: the list price and the percent / manual price entered with the sale are kept; only the
  // conversion to the sale currency uses the approval day's rate.
  const lines = s.lines.map((l) => {
    const at = `line ${l.lineNo}`
    const item = items.get(l.itemId)!
    if (!qtyBaseOf({ qty: dec(l.qty), unit: l.unit }, item, at).eq(dec(l.qtyBase))) throw new Error(`sale ${s.id} ${at}: unit factor changed`)
    return {
      id: l.id,
      itemId: l.itemId,
      qtyBase: dec(l.qtyBase),
      priced: priceSaleLine(
        { officialPriceIqd: dec(l.officialPriceIqd), qty: dec(l.qty), mode: l.priceMode, percent: l.percent ? dec(l.percent) : null, manual: l.manualPrice ? dec(l.manualPrice) : null },
        s.currency,
        rates,
        at,
      ),
    }
  })
  const t = saleTotals(lines.map((l) => l.priced))
  const post = await postCore(tx, rid, {
    saleId: s.id,
    date,
    currency: s.currency,
    paymentMode: s.paymentMode,
    rate: rateOf(rates, s.currency),
    customer,
    warehouseId: s.warehouseId,
    // stored when the sale was entered: a rep promoted since still gets the cash in their custody
    custodyRepId: s.paymentMode === 'CASH' ? s.custodyRepId : null,
    lines,
    priced: lines.map((l) => l.priced),
    user,
  })
  // lines first: the DB only lets lines change while their sale is still pending
  for (const [i, l] of lines.entries()) {
    await tx.whSaleLine.update({ where: { id: l.id }, data: { ...lineRow(l.priced), unitCostIqd: post.costs[i].toFixed() } })
    await tx.whSaleLineBatch.createMany({ data: batchRows(rid, post.batches[i]).map((b) => ({ ...b, saleLineId: l.id })) })
  }
  // the sale moves to today: a due date moves by the same number of days, so the agreed credit term is kept
  const requested = isoOf(s.date)
  const dueDate = s.dueDate ? addDays(isoOf(s.dueDate), daysBetween(requested, date)) : null
  await tx.whSale.update({
    where: { id: s.id },
    data: {
      status: 'POSTED',
      date: toDbDate(date),
      dueDate: dueDate ? toDbDate(dueDate) : null,
      rateSnapshot: snapshotOf(rates, [s.currency]),
      totalOfficial: t.totalOfficial.toFixed(),
      totalFinal: t.totalFinal.toFixed(),
      totalDiscount: t.totalDiscount.toFixed(),
      totalCostIqd: post.cogsIqd.toFixed(),
      journalEntryId: post.entryId,
      approvedById: user.id,
      decidedAt: new Date(),
    },
  })
  return post.warning ? { warning: post.warning } : {}
}

export async function rejectSaleTx(tx: Db, rid: string, user: WhUser, saleId: string, reason: string): Promise<void> {
  const why = requireReason(reason)
  const s = await lockSale(tx, rid, saleId)
  if (s.status !== 'PENDING_APPROVAL') throw new SaleStateError(`the sale is ${s.status.toLowerCase()}, not waiting for approval`)
  await tx.whSale.update({ where: { id: s.id }, data: { status: 'REJECTED', statusReason: why, decidedAt: new Date() } })
}

// ---------------------------------------------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------------------------------------------

/**
 * Cancel a posted sale (sale:cancel) by reversal, only while no payment and no return exists against it and it is
 * not the new sale of an exchange (SaleStateError otherwise). Reverses its journal entry (dated today, see reverseJournal) and puts each line's stock back into the
 * same warehouse at the ORIGINAL issue cost (receiveStock at that cost), so later sales are not re-valued: the
 * weighted average absorbs the returned units at what they were taken out at. Receiving never makes a balance
 * negative, so later stock movements cannot conflict with it.
 */
export async function cancelSaleTx(tx: Db, rid: string, user: WhUser, saleId: string, reason: string): Promise<void> {
  const why = requireReason(reason)
  const s = await lockSale(tx, rid, saleId)
  if (s.status !== 'POSTED') throw new SaleStateError(`only a posted sale can be cancelled (this one is ${s.status.toLowerCase()})`)
  if (await tx.whCustomerPayment.count({ where: { saleId: s.id } })) throw new SaleStateError('the sale has payments')
  // a return (or an exchange's new sale) already moved stock and money against it: it stays (the DB refuses it too)
  if (await tx.whSaleReturn.count({ where: { OR: [{ saleId: s.id }, { exchangeSaleId: s.id }] } })) throw new SaleStateError('the sale has returns')
  if (await tx.whSaleReturnOffset.count({ where: { saleId: s.id } })) throw new SaleStateError('the sale has returns')
  // A rep's cash sale put its money in the rep's custody; the reversal takes it out again, so it must still be there
  // and not already submitted in a pending handover (InsufficientCustodyError otherwise).
  // The rep is the one stored on the sale (custodyRepId), never derived from the user's current role.
  const custodyRep = s.paymentMode === 'CASH' ? await custodyRepOf(tx, s) : null
  if (custodyRep) {
    await lockCustody(tx, rid, custodyRep)
    await requireAvailableCustody(tx, rid, custodyRep, s.currency, dec(s.totalFinal))
  }
  await lockStockRows(tx, rid, s.lines.map((l) => ({ itemId: l.itemId, warehouseId: s.warehouseId })))
  const { entryId } = await reverseJournal(tx, rid, s.journalEntryId!, user, why)
  const ref = { type: 'SALE_CANCEL', id: s.id }
  // each portion back into its own expiry batch, at the line's original issue cost
  for (const l of s.lines) {
    const portions = l.batches.length ? l.batches.map((b) => ({ expiry: b.expiry ? isoOf(b.expiry) : null, qtyBase: dec(b.qtyBase) })) : [{ expiry: null, qtyBase: dec(l.qtyBase) }]
    if (!sum(portions.map((b) => b.qtyBase)).eq(dec(l.qtyBase))) throw new Error(`sale ${s.id} line ${l.lineNo}: batch portions do not sum to the line quantity`)
    for (const b of portions) await receiveStock(tx, { restaurantId: rid, itemId: l.itemId, warehouseId: s.warehouseId, qtyBase: b.qtyBase, unitCostIqd: dec(l.unitCostIqd!), expiry: b.expiry, ref, user })
  }
  await tx.whSale.update({ where: { id: s.id }, data: { status: 'CANCELLED', cancelEntryId: entryId, statusReason: why, decidedAt: new Date() } })
}

// ---------------------------------------------------------------------------------------------------------------
// Customer payments
// ---------------------------------------------------------------------------------------------------------------

export type CustomerPaymentInput = { customerId: string; amount: Dec; currency: Currency; date: string; saleId?: string | null }

/** receiveCustomerPayment inside the caller's transaction. Returns the journal entry id. */
export async function receiveCustomerPaymentTx(tx: Db, rid: string, user: WhUser, p: CustomerPaymentInput): Promise<{ entryId: string }> {
  if (!p || typeof p !== 'object') throw new InvalidSaleError('payment is required')
  const customer = await customerFor(tx, user, requireId(p.customerId, 'customer'))
  if (!isCurrency(p.currency)) throw new InvalidSaleError(`unknown currency: ${String(p.currency)}`)
  const amount = parseSaleAmount(p.amount, { label: 'amount', dp: AMOUNT_DP, min: 'positive' })
  // a REP's payment is dated today (the day picks the FX rate it settles at), like a rep's sale and expense
  const date = documentDate(user, p.date)
  const saleId = p.saleId ? requireId(p.saleId, 'sale') : undefined

  // The customer row lock serialises payments (no double settlement of one open balance), credit sales and cancellations.
  await lockRow(tx, rid, 'Customer', customer.id)
  if (saleId) {
    const target = await tx.whSale.findUnique({ where: { id: saleId }, select: { customerId: true, paymentMode: true, status: true, date: true } })
    if (!target || target.customerId !== customer.id) throw new InvalidSaleError('the sale is not one of this customer')
    if (date < isoOf(target.date)) throw new InvalidSaleError('a payment cannot be dated before its sale')
    if (target.paymentMode !== 'CREDIT') throw new InvalidSaleError('a cash sale has nothing to pay')
    if (target.status !== 'POSTED') throw new InvalidSaleError('the sale is not posted')
  }
  await assertPeriodOpen(tx, rid, date)
  // a payment never settles a sale dated after it (FIFO without saleId skips those)
  const open = (await receivables(tx, rid, customer.id, saleId)).filter((x) => x.open.gt(0) && x.date <= date)
  // Rates only for the paid currency and the currencies of the sales this payment actually reaches (as paySupplier).
  const wanted: Currency[] = [p.currency]
  let rates: PartialRates = await requireRates(tx, date, wanted)
  let settlements: ReturnType<typeof settlePayment>
  for (;;) {
    try {
      settlements = settlePayment(amount, p.currency, open, rates)
      break
    } catch (e) {
      // settlePayment is shared with supplier payments: its "too small to settle anything" error is a bad input here
      if (e instanceof InvalidPurchaseError) throw new InvalidSaleError(e.message)
      if (!(e instanceof RateMissingError) || wanted.includes(e.currency)) throw e
      wanted.push(e.currency)
      rates = await requireRates(tx, date, wanted)
    }
  }
  const payRate = p.currency === 'IQD' ? new D(1) : new D(rates.iqdPer[p.currency]!)
  const byRep = user.role === 'REP'

  const rows = settlements.map((s) => {
    const doc = s.doc as Receivable
    const arIqd = round4(s.settled.times(doc.lockedRate))
    const cashIqd = round4(s.paid.times(payRate))
    // positive: the customer handed over more IQD value than the receivable carried -> gain
    return { doc, settled: s.settled, paid: s.paid, fx: cashIqd.minus(arIqd) }
  })
  const fx = sum(rows.map((r) => r.fx))
  const lines: LineInput[] = rows.map((r) =>
    byRep
      ? { accountCode: 'REP_CUSTODY', side: 'DR', amount: r.paid, currency: p.currency, partyId: user.id }
      : { accountCode: cashAccount(p.currency), side: 'DR', amount: r.paid, currency: p.currency },
  )
  if (fx.lt(0)) lines.push({ accountCode: 'FX_LOSS', side: 'DR', amount: fx.abs(), currency: 'IQD' })
  for (const r of rows)
    lines.push({ accountCode: 'AR', side: 'CR', amount: r.settled, currency: r.doc.currency, partyId: customer.id, ...(r.doc.currency === 'IQD' ? {} : { rateIqd: r.doc.lockedRate }) })
  if (fx.gt(0)) lines.push({ accountCode: 'FX_GAIN', side: 'CR', amount: fx, currency: 'IQD' })

  const paymentId = randomUUID()
  const { entryId } = await postJournal(tx, rid, { date, memo: `Payment from ${customer.name}`, source: { type: 'CUSTOMER_PAYMENT', id: paymentId }, user, lines })
  const snap = snapshotOf(rates, [p.currency, ...rows.map((r) => r.doc.currency)])
  for (const r of rows)
    await tx.whCustomerPayment.create({
      data: {
        restaurantId: rid,
        customerId: customer.id,
        saleId: r.doc.kind === 'SALE' ? r.doc.id : null,
        openingDebtId: r.doc.kind === 'OPENING' ? r.doc.id : null,
        amount: r.paid.toFixed(),
        currency: p.currency,
        date: toDbDate(date),
        settledInSaleCcy: r.settled.toFixed(),
        rateSnapshot: snap,
        fxDiffIqd: r.fx.toFixed(),
        receivedByRep: byRep,
        journalEntryId: entryId,
        userId: user.id,
      },
    })
  return { entryId }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading. Role rules are part of the query: a REP only reaches their own customers' sales, and cost fields are
// only selected for cost:view.
// ---------------------------------------------------------------------------------------------------------------

function saleScope(user: WhUser): Prisma.WhSaleWhereInput {
  return seesAllCustomers(user) ? {} : { customer: { repId: user.id } }
}

/** Sales visible to the user, newest first (no cost fields for anyone: the list does not need them). */
export async function listSales(tx: Db, user: WhUser) {
  const rows = await tx.whSale.findMany({
    where: saleScope(user),
    orderBy: { number: 'desc' },
    take: 200,
    select: {
      id: true,
      number: true,
      date: true,
      currency: true,
      paymentMode: true,
      status: true,
      totalFinal: true,
      customer: { select: { id: true, name: true } },
    },
  })
  return rows.map((r) => ({ ...r, number: r.number.toString(), date: isoOf(r.date) }))
}

/** Sales waiting for price approval (sale:approve). */
export async function listPendingSales(tx: Db) {
  const rows = await tx.whSale.findMany({
    where: { status: 'PENDING_APPROVAL' },
    orderBy: { requestedAt: 'asc' },
    select: {
      id: true,
      number: true,
      date: true,
      requestedAt: true,
      currency: true,
      totalOfficial: true,
      totalFinal: true,
      customer: { select: { id: true, name: true } },
      userId: true,
    },
  })
  return rows.map((r) => ({ ...r, number: r.number.toString(), date: isoOf(r.date) }))
}

const saleLineBase = {
  id: true,
  lineNo: true,
  itemId: true,
  unit: true,
  qty: true,
  qtyBase: true,
  priceMode: true,
  percent: true,
  manualPrice: true,
  officialPriceIqd: true,
  officialPrice: true,
  finalPrice: true,
  discount: true,
  lineTotal: true,
  item: { select: { code: true, names: true } },
} as const

const saleBase = {
  id: true,
  number: true,
  date: true,
  requestedAt: true,
  currency: true,
  paymentMode: true,
  dueDate: true,
  status: true,
  statusReason: true,
  rateSnapshot: true,
  totalOfficial: true,
  totalFinal: true,
  totalDiscount: true,
  userId: true,
  approvedById: true,
  createdAt: true,
  customer: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  payments: { orderBy: { createdAt: 'asc' }, select: { id: true, date: true, amount: true, currency: true, settledInSaleCcy: true, receivedByRep: true } },
  returnOffsets: { select: { returnId: true, amount: true } },
} as const

/**
 * One sale with lines, payments, what is paid and what is still open (credit sales). null when it does not exist or
 * is not visible to the user (another rep's customer). The cost fields (totalCostIqd, unitCostIqd and the journal
 * entry ids) are only SELECTED for cost:view, so a REP's result does not have those keys at all. `db`: the client to
 * read with (the invoice PDF and its tests pass their transaction).
 */
export async function getSale(db: Db, user: WhUser, id: string) {
  if (typeof id !== 'string' || !id) return null
  const where = { id, ...saleScope(user) }
  type Row = {
    date: Date
    dueDate: Date | null
    number: bigint
    totalFinal: Prisma.Decimal
    status: string
    paymentMode: string
    payments: { date: Date; settledInSaleCcy: Prisma.Decimal }[]
    returnOffsets: { amount: Prisma.Decimal }[]
    lines: { item: { code: string; names: unknown } }[]
  }
  const shape = <T extends Row>(s: T) => {
    type Line = T['lines'][number]
    type Payment = T['payments'][number]
    const paid = sum(s.payments.map((x) => dec(x.settledInSaleCcy)))
    const offset = sum(s.returnOffsets.map((x) => dec(x.amount)))
    return {
      ...(s as Omit<T, 'lines' | 'payments' | 'number' | 'date' | 'dueDate'>),
      number: s.number.toString(),
      date: isoOf(s.date),
      dueDate: s.dueDate ? isoOf(s.dueDate) : null,
      lines: s.lines.map((l: Line) => {
        const { item, ...rest } = l
        return { ...(rest as Omit<Line, 'item'>), itemCode: item.code, itemNames: item.names as Names }
      }),
      payments: s.payments.map((x: Payment) => ({ ...(x as Omit<Payment, 'date'>), date: isoOf(x.date) })),
      paidInSaleCcy: paid,
      /** Returns credited to this sale's debt (DEBT_OFFSET), in the sale currency. */
      returnedOffInSaleCcy: offset,
      open: s.paymentMode === 'CREDIT' && s.status === 'POSTED' ? dec(s.totalFinal).minus(paid).minus(offset) : new D(0),
    }
  }
  if (canWh(user.role, 'cost.view')) {
    const s = await db.whSale.findFirst({
      where,
      select: { ...saleBase, totalCostIqd: true, journalEntryId: true, cancelEntryId: true, lines: { orderBy: { lineNo: 'asc' }, select: { ...saleLineBase, unitCostIqd: true } } },
    })
    return s ? shape(s) : null
  }
  const s = await db.whSale.findFirst({ where, select: { ...saleBase, lines: { orderBy: { lineNo: 'asc' }, select: saleLineBase } } })
  return s ? shape(s) : null
}

export type CustomerStatementRow = {
  date: string
  kind: 'SALE' | 'PAYMENT' | 'CANCEL' | 'RETURN' | 'OPENING'
  saleId: string | null
  saleNumber: string | null
  currency: Currency
  /** Increase of what the customer owes, in `currency`. */
  charge: Decimal
  /** Decrease of what the customer owes, in `currency` (a payment: the part of the sale it settled; a return: the
   * part credited to the sale's debt). */
  paid: Decimal
  /** What was actually handed over, for a payment (may be another currency). */
  paidAmount: Decimal | null
  paidCurrency: Currency | null
  /** Running balance in `currency` after this row. */
  balance: Decimal
}

/**
 * The customer's account in the currencies of their credit sales: opening debts, credit sales, payments (one row per settled document),
 * returns credited to the debt (one row per sale offset) and cancellations, chronological, with a running balance per currency. A REP only for their own customers
 * (ForbiddenError otherwise); never any cost.
 */
export async function customerStatement(tx: Db, user: WhUser, customerId: string): Promise<{ rows: CustomerStatementRow[]; balances: Partial<Record<Currency, Decimal>> }> {
  const visible = await tx.whCustomer.findFirst({ where: { id: customerId, ...(seesAllCustomers(user) ? {} : { repId: user.id }) }, select: { id: true } })
  if (!visible) throw new ForbiddenError('customer:view-own')
  const [sales, payments, offsets, openings] = await Promise.all([
    tx.whSale.findMany({
      where: { customerId, paymentMode: 'CREDIT', status: { in: ['POSTED', 'CANCELLED'] } },
      select: { id: true, number: true, date: true, currency: true, totalFinal: true, status: true, createdAt: true, decidedAt: true, cancelEntry: { select: { date: true } } },
    }),
    tx.whCustomerPayment.findMany({ where: { customerId }, include: { sale: { select: { number: true, currency: true } }, openingDebt: { select: { currency: true } } } }),
    tx.whSaleReturnOffset.findMany({
      where: { sale: { customerId } },
      include: { sale: { select: { number: true, currency: true } }, saleReturn: { select: { date: true, createdAt: true } } },
    }),
    tx.whOpeningDebt.findMany({ where: { customerId }, orderBy: [{ createdAt: 'asc' }, { lineNo: 'asc' }] }),
  ])
  type Raw = Omit<CustomerStatementRow, 'balance'> & { at: Date; order: number }
  const zero = new D(0)
  const raw: Raw[] = []
  for (const o of openings)
    raw.push({ date: isoOf(o.date), at: o.createdAt, order: 0, kind: 'OPENING', saleId: null, saleNumber: null, currency: o.currency, charge: dec(o.amount), paid: zero, paidAmount: null, paidCurrency: null })
  for (const x of payments) {
    if (!x.openingDebt) continue
    raw.push({ date: isoOf(x.date), at: x.createdAt, order: 1, kind: 'PAYMENT', saleId: null, saleNumber: null, currency: x.openingDebt.currency, charge: zero, paid: dec(x.settledInSaleCcy), paidAmount: dec(x.amount), paidCurrency: x.currency })
  }
  for (const s of sales) {
    raw.push({ date: isoOf(s.date), at: s.createdAt, order: 0, kind: 'SALE', saleId: s.id, saleNumber: s.number.toString(), currency: s.currency, charge: dec(s.totalFinal), paid: zero, paidAmount: null, paidCurrency: null })
    if (s.status === 'CANCELLED' && s.cancelEntry)
      raw.push({ date: isoOf(s.cancelEntry.date), at: s.decidedAt ?? s.createdAt, order: 2, kind: 'CANCEL', saleId: s.id, saleNumber: s.number.toString(), currency: s.currency, charge: zero, paid: dec(s.totalFinal), paidAmount: null, paidCurrency: null })
  }
  for (const x of payments) {
    if (!x.sale) continue
    raw.push({
      date: isoOf(x.date),
      at: x.createdAt,
      order: 1,
      kind: 'PAYMENT',
      saleId: x.saleId,
      saleNumber: x.sale.number.toString(),
      currency: x.sale.currency,
      charge: zero,
      paid: dec(x.settledInSaleCcy),
      paidAmount: dec(x.amount),
      paidCurrency: x.currency,
    })
  }
  for (const o of offsets)
    raw.push({
      date: isoOf(o.saleReturn.date),
      at: o.saleReturn.createdAt,
      order: 1,
      kind: 'RETURN',
      saleId: o.saleId,
      saleNumber: o.sale.number.toString(),
      currency: o.sale.currency,
      charge: zero,
      paid: dec(o.amount),
      paidAmount: null,
      paidCurrency: null,
    })
  raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at.getTime() - b.at.getTime() || a.order - b.order))
  const balances: Partial<Record<Currency, DD>> = {}
  const rows: CustomerStatementRow[] = raw.map((r) => {
    const b = (balances[r.currency] ?? new D(0)).plus(r.charge).minus(r.paid)
    balances[r.currency] = b
    const { date, kind, saleId, saleNumber, currency, charge, paid, paidAmount, paidCurrency } = r
    return { date, kind, saleId, saleNumber, currency, charge, paid, paidAmount, paidCurrency, balance: b }
  })
  return { rows, balances }
}

/** Warehouses the user may sell from (the sale form): a REP only their own; OWNER/PARTNER main and rep warehouses. */
export async function saleWarehouses(tx: Db, user: WhUser): Promise<{ id: string; name: string; kind: 'MAIN' | 'REP' | 'DAMAGE' }[]> {
  const where: Prisma.WhWarehouseWhereInput = canWh(user.role, 'stock.transfer') ? { kind: { in: ['MAIN', 'REP'] } } : { kind: 'REP', repUserId: user.id }
  return tx.whWarehouse.findMany({ where, orderBy: [{ kind: 'asc' }, { name: 'asc' }], select: { id: true, name: true, kind: true } })
}
