/* eslint-disable no-restricted-properties -- row locks: every statement binds "restaurantId" (the company's own id) */
import { randomUUID } from 'node:crypto'
import type Decimal from 'decimal.js'
import type { ScopedTx } from '@/server/data/tenant-db'
import { allocate } from '@/server/domain/wholesale/allocate'
import { isUnit, type Names, type Unit } from '@/server/domain/wholesale/catalog'
import { QTY_DP } from '@/server/domain/wholesale/costing'
import { AMOUNT_DP, AMOUNT_MAX, type LineInput } from '@/server/domain/wholesale/ledger'
import { D } from '@/server/domain/wholesale/money'
import { toBase } from '@/server/domain/wholesale/pricing'
import {
  InvalidPurchaseError,
  PurchaseNotCancellableError,
  PurchaseStateError,
  isCurrency,
  isLandedCostKind,
  isPaymentMode,
  parseAmount,
  round4,
  settlePayment,
  snapshotOf,
  snapshotRate,
  type LandedCostKind,
  type OpenDoc,
  type PaymentMode,
} from '@/server/domain/wholesale/purchase'
import { RateMissingError, isIsoDate, type Currency } from '@/server/domain/wholesale/rates'
import { assertNotFuture } from '@/server/wholesale/clock'
import { postJournal, reverseJournal } from '@/server/wholesale/ledger'
import { assertPeriodOpen } from '@/server/wholesale/period'
import { requireRates } from '@/server/wholesale/rates'
import { lockStockRows, receiveStock, recostOnHand, reverseReceipt, stockKey } from '@/server/wholesale/stock'
import { warehouseOfKind } from '@/server/wholesale/warehouses'

export { InvalidPurchaseError, OverpaymentError, PurchaseNotCancellableError, PurchaseStateError } from '@/server/domain/wholesale/purchase'

/*
 * Purchases: posting, landed costs, supplier payments, cancellation, supplier statement.
 *
 * Every write runs in ONE transaction (the exported functions open it with withTx; the *Tx variants join the caller's,
 * for a form that posts a purchase and its landed costs together): validate -> period open -> rates -> lock -> stock
 * -> journal -> document rows -> audit. Any failure rolls everything back, so nothing is ever partly saved.
 *
 * Money rules:
 * - A purchase's IQD cost is fixed at its posting day's rate (rateSnapshot) and never changes. Each line's stock cost
 *   = line total x that rate / base quantity; the stock engine stores it at 8 dp and returns it. INVENTORY is debited
 *   with sum(qtyBase x returned cost) rounded once to 4 dp, so ledger and stock agree; the sub-fils gap to the cash/AP
 *   credit (total x rate, 4 dp) goes to ROUNDING in the same entry.
 * - AP is per supplier (JournalLine.partyId) and stays in the purchase currency. Open balances are per document
 *   (credit purchase, credit landed cost, opening debt), derived as amount - sum(SupplierPayment.settledInPurchaseCcy)
 *   - for a purchase, the returns offset against its debt (PurchaseReturn DEBT_OFFSET, posting/purchaseReturn.ts).
 * - A payment debits AP at the document's locked rate (a pinned line rate) and credits cash at the payment day's rate;
 *   the IQD difference goes to FX_LOSS (paid more IQD value) or FX_GAIN.
 * - A landed cost uses its OWN date's rate, is allocated over the lines by line value (allocate: parts sum exactly),
 *   and the share of quantity still on hand in the receiving warehouse re-costs that stock; the rest (sold or moved
 *   out) goes to COGS.
 *
 * Lock order (no cycles): Supplier row -> Purchase row -> Item rows (share) -> StockBalance rows (lockStockRows).
 */

type Db = ScopedTx
type SessionUser = { id: string }
type DD = InstanceType<typeof D>
type Dec = Decimal | string

const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`)
const isoOf = (d: Date): string => d.toISOString().slice(0, 10)
const QTY_MAX = new D(10).pow(24 - QTY_DP)
const MAX_LINES = 500
const dec = (v: { toString(): string }): DD => new D(v.toString())
const sum = (xs: DD[]): DD => xs.reduce((a, b) => a.plus(b), new D(0))

function requireDate(v: unknown, label: string): string {
  if (!isIsoDate(v)) throw new InvalidPurchaseError(`${label} must be a date (YYYY-MM-DD)`)
  return v
}

/** A document date: a real date, never after today + slack (FutureDateError, see server/clock.ts). */
function requireDocDate(v: unknown, label: string): string {
  const d = requireDate(v, label)
  assertNotFuture(d)
  return d
}

function optionalDate(v: unknown, label: string): string | null {
  if (v === undefined || v === null || v === '') return null
  return requireDate(v, label)
}

function requireId(v: unknown, label: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new InvalidPurchaseError(`${label} is required`)
  return v.trim()
}

const cashAccount = (c: Currency) => `CASH_${c}`

/**
 * SELECT ... FOR NO KEY UPDATE on one row; false when it does not exist. It serialises payments, landed costs and
 * cancellations on that row, but (unlike FOR UPDATE) does not block the FOR KEY SHARE that inserting a row with a
 * foreign key to it takes, so a purchase being posted for the same supplier cannot deadlock with a cancellation.
 */
async function lockRow(tx: Db, rid: string, table: 'Supplier' | 'Purchase', id: string): Promise<boolean> {
  const rows =
    table === 'Supplier'
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "WhSupplier" WHERE id = ${id} AND "restaurantId" = ${rid} FOR NO KEY UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "WhPurchase" WHERE id = ${id} AND "restaurantId" = ${rid} FOR NO KEY UPDATE`
  return rows.length > 0
}

/** Lock a purchase's supplier, then the purchase (the global lock order); InvalidPurchaseError when it does not exist. */
export async function lockPurchase(tx: Db, rid: string, purchaseId: string): Promise<void> {
  const id = requireId(purchaseId, 'purchase')
  const head = await tx.whPurchase.findUnique({ where: { id }, select: { supplierId: true } })
  if (!head) throw new InvalidPurchaseError('unknown purchase')
  await lockRow(tx, rid, 'Supplier', head.supplierId)
  await lockRow(tx, rid, 'Purchase', id)
}

// ---------------------------------------------------------------------------------------------------------------
// Posting a purchase
// ---------------------------------------------------------------------------------------------------------------

export type PurchaseLineInput = { itemId: string; unit: Unit; qty: Dec; unitPrice: Dec; expiry?: string | null }
export type PurchaseInput = {
  supplierId: string
  date: string
  currency: Currency
  paymentMode: PaymentMode
  dueDate?: string | null
  /** Receiving warehouse; default MAIN. */
  warehouseId?: string | null
  lines: PurchaseLineInput[]
}

type CleanLine = { itemId: string; unit: Unit; qty: DD; unitPrice: DD; lineTotal: DD; expiry: string | null }

/** Shape checks that need no item data. */
async function cleanHeader(tx: Db, rid: string, input: PurchaseInput) {
  if (!input || typeof input !== 'object') throw new InvalidPurchaseError('purchase is required')
  const supplierId = requireId(input.supplierId, 'supplier')
  const supplier = await tx.whSupplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, active: true } })
  if (!supplier) throw new InvalidPurchaseError('unknown supplier')
  if (!supplier.active) throw new InvalidPurchaseError('the supplier is archived')
  const date = requireDocDate(input.date, 'date')
  if (!isCurrency(input.currency)) throw new InvalidPurchaseError(`unknown currency: ${String(input.currency)}`)
  if (!isPaymentMode(input.paymentMode)) throw new InvalidPurchaseError(`unknown payment mode: ${String(input.paymentMode)}`)
  const dueDate = optionalDate(input.dueDate, 'due date')
  if (dueDate !== null && input.paymentMode !== 'CREDIT') throw new InvalidPurchaseError('only a credit purchase has a due date')
  if (dueDate !== null && dueDate < date) throw new InvalidPurchaseError('the due date is before the purchase date')
  let warehouseId: string
  if (input.warehouseId === undefined || input.warehouseId === null || input.warehouseId === '') warehouseId = (await warehouseOfKind(tx, rid, 'MAIN')).id
  else {
    const w = await tx.whWarehouse.findUnique({ where: { id: String(input.warehouseId) }, select: { id: true, kind: true } })
    if (!w) throw new InvalidPurchaseError('unknown warehouse')
    if (w.kind === 'DAMAGE') throw new InvalidPurchaseError('purchases cannot be received into the damage warehouse')
    warehouseId = w.id
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new InvalidPurchaseError('a purchase needs at least one line')
  if (input.lines.length > MAX_LINES) throw new InvalidPurchaseError(`a purchase has at most ${MAX_LINES} lines`)
  const lines: CleanLine[] = input.lines.map((l, i) => {
    const at = `line ${i + 1}`
    if (!l || typeof l !== 'object') throw new InvalidPurchaseError(`${at}: not a line`)
    const itemId = requireId(l.itemId, `${at}: item`)
    if (!isUnit(l.unit)) throw new InvalidPurchaseError(`${at}: unknown unit ${String(l.unit)}`)
    const qty = parseAmount(l.qty, { label: `${at}: quantity`, dp: QTY_DP, min: 'positive', max: QTY_MAX })
    const unitPrice = parseAmount(l.unitPrice, { label: `${at}: unit price`, dp: AMOUNT_DP, min: 'zero' })
    const lineTotal = round4(qty.times(unitPrice))
    if (lineTotal.gte(AMOUNT_MAX)) throw new InvalidPurchaseError(`${at}: line total is too large`)
    return { itemId, unit: l.unit, qty, unitPrice, lineTotal, expiry: optionalDate(l.expiry, `${at}: expiry`) }
  })
  const total = sum(lines.map((l) => l.lineTotal))
  if (!total.gt(0)) throw new InvalidPurchaseError('the purchase total must be greater than zero')
  if (total.gte(AMOUNT_MAX)) throw new InvalidPurchaseError('the purchase total is too large')
  return { supplier, date, currency: input.currency, paymentMode: input.paymentMode, dueDate, warehouseId, lines, total }
}

/** postPurchase inside the caller's transaction. */
export async function postPurchaseTx(tx: Db, rid: string, user: SessionUser, input: PurchaseInput): Promise<{ purchaseId: string }> {
  const c = await cleanHeader(tx, rid, input)
  const itemIds = [...new Set(c.lines.map((l) => l.itemId))]
  const known = await tx.whItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, active: true } })
  for (const id of itemIds) {
    const it = known.find((k) => k.id === id)
    if (!it) throw new InvalidPurchaseError(`unknown item: ${id}`)
    if (!it.active) throw new InvalidPurchaseError(`item is archived: ${id}`)
  }
  await assertPeriodOpen(tx, rid, c.date)
  const rates = await requireRates(tx, c.date, [c.currency])
  const rate = c.currency === 'IQD' ? new D(1) : new D(rates.iqdPer[c.currency]!)

  // Lock first (items FOR SHARE, then balances in order), then read the unit factors, which cannot change under us.
  await lockStockRows(tx, rid, itemIds.map((itemId) => ({ itemId, warehouseId: c.warehouseId })))
  const items = await tx.whItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, baseUnit: true, units: { select: { unit: true, factorToBase: true } } } })
  const byId = new Map(items.map((i) => [i.id, i]))
  const priced = c.lines.map((l, i) => {
    const item = byId.get(l.itemId)!
    if (!item.units.some((u) => u.unit === l.unit) && l.unit !== item.baseUnit) throw new InvalidPurchaseError(`line ${i + 1}: the item has no ${l.unit} unit`)
    const qtyBase = toBase(l.qty, l.unit, item)
    if (qtyBase.decimalPlaces() > QTY_DP) throw new InvalidPurchaseError(`line ${i + 1}: quantity in the base unit has more than ${QTY_DP} decimal places`)
    if (qtyBase.gte(QTY_MAX)) throw new InvalidPurchaseError(`line ${i + 1}: quantity is too large`)
    return { ...l, qtyBase }
  })

  const purchaseId = randomUUID()
  const ref = { type: 'PURCHASE', id: purchaseId }
  const received: DD[] = []
  for (const l of priced) {
    // exact IQD cost per base unit at the locked rate; the engine rounds it to 8 dp and tells us what it stored
    const r = await receiveStock(tx, { restaurantId: rid, itemId: l.itemId, warehouseId: c.warehouseId, qtyBase: l.qtyBase, unitCostIqd: l.lineTotal.times(rate).div(l.qtyBase), expiry: l.expiry, ref, user })
    received.push(new D(r.unitCostIqd))
  }
  const inventoryIqd = round4(sum(priced.map((l, i) => l.qtyBase.times(received[i]))))
  const totalIqd = round4(c.total.times(rate))
  const gap = totalIqd.minus(inventoryIqd)
  // qty x 0.5e-8 per line from storing costs at 8 dp, plus the two 4-dp roundings: never near 1 IQD unless broken
  if (gap.abs().gte(1)) throw new Error(`purchase ${purchaseId}: inventory ${inventoryIqd.toFixed()} vs total ${totalIqd.toFixed()} IQD`)

  const lines: LineInput[] = []
  if (inventoryIqd.gt(0)) lines.push({ accountCode: 'INVENTORY', side: 'DR', amount: inventoryIqd, currency: 'IQD' })
  if (gap.gt(0)) lines.push({ accountCode: 'ROUNDING', side: 'DR', amount: gap, currency: 'IQD' })
  lines.push(
    c.paymentMode === 'CASH'
      ? { accountCode: cashAccount(c.currency), side: 'CR', amount: c.total, currency: c.currency }
      : { accountCode: 'AP', side: 'CR', amount: c.total, currency: c.currency, partyId: c.supplier.id },
  )
  if (gap.lt(0)) lines.push({ accountCode: 'ROUNDING', side: 'CR', amount: gap.abs(), currency: 'IQD' })
  const { entryId } = await postJournal(tx, rid, { date: c.date, memo: `Purchase from ${c.supplier.name}`, source: ref, user, lines })

  await tx.whPurchase.create({
    data: {
      id: purchaseId,
      restaurantId: rid,
      supplierId: c.supplier.id,
      date: toDbDate(c.date),
      currency: c.currency,
      paymentMode: c.paymentMode,
      dueDate: c.dueDate ? toDbDate(c.dueDate) : null,
      warehouseId: c.warehouseId,
      rateSnapshot: snapshotOf(rates, [c.currency]),
      totalOriginal: c.total.toFixed(),
      totalIqd: totalIqd.toFixed(),
      journalEntryId: entryId,
      userId: user.id,
      lines: {
        create: priced.map((l, i) => ({
          restaurantId: rid,
          lineNo: i + 1,
          itemId: l.itemId,
          unit: l.unit,
          qty: l.qty.toFixed(),
          qtyBase: l.qtyBase.toFixed(),
          unitPrice: l.unitPrice.toFixed(),
          lineTotal: l.lineTotal.toFixed(),
          expiry: l.expiry ? toDbDate(l.expiry) : null,
          unitCostIqd: received[i].toFixed(),
        })),
      },
    },
    select: { id: true, number: true },
  })
  return { purchaseId }
}

/** Post a purchase in its own transaction: stock in at the locked rate, DR INVENTORY / CR CASH_<currency> or AP. */
// ---------------------------------------------------------------------------------------------------------------
// Landed costs
// ---------------------------------------------------------------------------------------------------------------

export type LandedCostInput = {
  kind: LandedCostKind
  amount: Dec
  currency: Currency
  date: string
  /** Default CASH. */
  paymentMode?: PaymentMode
  /** The payee of a CREDIT landed cost; default the purchase's supplier. Not allowed on CASH. */
  supplierId?: string | null
}

/** addLandedCost inside the caller's transaction. */
export async function addLandedCostTx(tx: Db, rid: string, user: SessionUser, purchaseId: string, c: LandedCostInput): Promise<{ landedCostId: string }> {
  if (!c || typeof c !== 'object') throw new InvalidPurchaseError('landed cost is required')
  if (!isLandedCostKind(c.kind)) throw new InvalidPurchaseError(`unknown landed cost kind: ${String(c.kind)}`)
  if (!isCurrency(c.currency)) throw new InvalidPurchaseError(`unknown currency: ${String(c.currency)}`)
  const amount = parseAmount(c.amount, { label: 'amount', dp: AMOUNT_DP, min: 'positive' })
  const date = requireDocDate(c.date, 'date')
  const mode: PaymentMode = c.paymentMode ?? 'CASH'
  if (!isPaymentMode(mode)) throw new InvalidPurchaseError(`unknown payment mode: ${String(mode)}`)
  if (mode === 'CASH' && c.supplierId) throw new InvalidPurchaseError('a cash landed cost has no payee')

  const id = requireId(purchaseId, 'purchase')
  if (!(await lockRow(tx, rid, 'Purchase', id))) throw new InvalidPurchaseError('unknown purchase')
  const p = await tx.whPurchase.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
  if (p.status !== 'POSTED') throw new PurchaseStateError('the purchase is cancelled')
  if (date < isoOf(p.date)) throw new InvalidPurchaseError('a landed cost cannot be dated before its purchase')
  let payeeId: string | null = null
  if (mode === 'CREDIT') {
    payeeId = c.supplierId ? String(c.supplierId) : p.supplierId
    const payee = await tx.whSupplier.findUnique({ where: { id: payeeId }, select: { id: true, active: true } })
    if (!payee) throw new InvalidPurchaseError('unknown payee supplier')
    if (!payee.active) throw new InvalidPurchaseError('the payee supplier is archived')
  }

  await assertPeriodOpen(tx, rid, date)
  const rates = await requireRates(tx, date, [c.currency])
  const rate = c.currency === 'IQD' ? new D(1) : new D(rates.iqdPer[c.currency]!)
  const amountIqd = round4(amount.times(rate))
  if (!amountIqd.gt(0)) throw new InvalidPurchaseError('the amount is worth less than 0.0001 IQD')

  // Both splits use the same weights; each sums exactly to its total, so the entry balances exactly.
  const weights = p.lines.map((l) => dec(l.lineTotal))
  const partsOriginal = allocate(amount, weights)
  const partsIqd = allocate(amountIqd, weights)

  const itemIds = [...new Set(p.lines.map((l) => l.itemId))]
  const locked = await lockStockRows(tx, rid, itemIds.map((itemId) => ({ itemId, warehouseId: p.warehouseId })))
  // Share still on hand per item: min(on hand, received) / received (several lines of one item share the on-hand).
  // KNOWN, ACCEPTED SIMPLIFICATION: "on hand" is the item's whole balance in the receiving warehouse, not this
  // purchase's own units. After sell-then-restock the expense can be capitalised onto another purchase's units (and
  // stock moved to a rep warehouse counts as sold). Ledger and stock still agree: the INVENTORY debit is exactly
  // what recostOnHand adds to the stock value, and the rest is COGS.
  const share = new Map<string, DD>()
  for (const itemId of itemIds) {
    const received = sum(p.lines.filter((l) => l.itemId === itemId).map((l) => dec(l.qtyBase)))
    const onHand = new D(locked.get(stockKey(itemId, p.warehouseId))!.qtyBase)
    share.set(itemId, D.min(onHand, received).div(received))
  }
  const allocs = p.lines.map((l, i) => {
    const iqd = new D(partsIqd[i])
    const toInventory = round4(iqd.times(share.get(l.itemId)!))
    return { lineId: l.id, itemId: l.itemId, amountOriginal: new D(partsOriginal[i]), toInventory, toCogs: iqd.minus(toInventory) }
  })

  const landedCostId = randomUUID()
  const ref = { type: 'LANDED_COST', id: landedCostId }
  for (const itemId of itemIds) {
    const add = sum(allocs.filter((a) => a.itemId === itemId).map((a) => a.toInventory))
    if (add.gt(0)) await recostOnHand(tx, rid, itemId, p.warehouseId, add, { ref, user })
  }
  const toInventory = sum(allocs.map((a) => a.toInventory))
  const toCogs = sum(allocs.map((a) => a.toCogs))
  const lines: LineInput[] = []
  if (toInventory.gt(0)) lines.push({ accountCode: 'INVENTORY', side: 'DR', amount: toInventory, currency: 'IQD' })
  if (toCogs.gt(0)) lines.push({ accountCode: 'COGS', side: 'DR', amount: toCogs, currency: 'IQD' })
  lines.push(
    mode === 'CASH'
      ? { accountCode: cashAccount(c.currency), side: 'CR', amount, currency: c.currency }
      : { accountCode: 'AP', side: 'CR', amount, currency: c.currency, partyId: payeeId! },
  )
  const { entryId } = await postJournal(tx, rid, { date, memo: `Landed cost (${c.kind}) for purchase #${p.number}`, source: ref, user, lines })

  await tx.whLandedCost.create({
    data: {
      id: landedCostId,
      restaurantId: rid,
      purchaseId: p.id,
      kind: c.kind,
      amount: amount.toFixed(),
      currency: c.currency,
      date: toDbDate(date),
      rateSnapshot: snapshotOf(rates, [c.currency]),
      amountIqd: amountIqd.toFixed(),
      paymentMode: mode,
      supplierId: payeeId,
      journalEntryId: entryId,
      userId: user.id,
      allocations: {
        create: allocs.map((a) => ({ restaurantId: rid, lineId: a.lineId, amountOriginal: a.amountOriginal.toFixed(), iqdToInventory: a.toInventory.toFixed(), iqdToCogs: a.toCogs.toFixed() })),
      },
    },
  })
  return { landedCostId }
}

// ---------------------------------------------------------------------------------------------------------------
// Supplier payments
// ---------------------------------------------------------------------------------------------------------------

export type Payable = OpenDoc & { supplierId: string; lockedRate: DD; date: string; dueDate: string | null; createdAt: Date; amount: DD; number: bigint | null }

/**
 * What has been returned to the supplier against each of these purchases as a debt offset (PurchaseReturn
 * DEBT_OFFSET totalValue, purchase currency): it reduces the purchase's open balance like a payment.
 */
export async function returnedOffsets(db: Db, purchaseIds: string[]): Promise<Map<string, DD>> {
  const rows = purchaseIds.length
    ? await db.whPurchaseReturn.findMany({ where: { purchaseId: { in: purchaseIds }, refund: 'DEBT_OFFSET' }, select: { purchaseId: true, totalValue: true } })
    : []
  const out = new Map<string, DD>()
  for (const r of rows) out.set(r.purchaseId, (out.get(r.purchaseId) ?? new D(0)).plus(dec(r.totalValue)))
  return out
}

/**
 * A supplier's credit documents with what is still open on each (amount - settlements - returns offset against it),
 * FIFO-sorted: credit purchases, credit landed costs and, unless one purchase is asked for, opening debts owed to the
 * supplier (import/opening.ts; dated the opening date, so they come first). `supplierId` null = every supplier (the
 * payables report, src/server/reports/payables.ts).
 */
async function payables(db: Db, supplierId: string | null, purchaseId?: string): Promise<Payable[]> {
  const who = supplierId === null ? {} : { supplierId }
  const purchases = await db.whPurchase.findMany({
    where: { ...who, paymentMode: 'CREDIT', status: 'POSTED', ...(purchaseId ? { id: purchaseId } : {}) },
    select: { id: true, supplierId: true, number: true, currency: true, totalOriginal: true, rateSnapshot: true, date: true, dueDate: true, createdAt: true },
  })
  const landed = purchaseId
    ? []
    : await db.whLandedCost.findMany({
        where: supplierId === null ? { supplierId: { not: null }, paymentMode: 'CREDIT', purchase: { status: 'POSTED' } } : { supplierId, paymentMode: 'CREDIT', purchase: { status: 'POSTED' } },
        select: { id: true, supplierId: true, currency: true, amount: true, rateSnapshot: true, date: true, createdAt: true },
      })
  const openings = purchaseId
    ? []
    : await db.whOpeningDebt.findMany({
        where: supplierId === null ? { supplierId: { not: null } } : { supplierId },
        select: { id: true, supplierId: true, currency: true, amount: true, rateIqd: true, date: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { lineNo: 'asc' }],
      })
  const paid = await db.whSupplierPayment.findMany({
    where: {
      OR: [{ purchaseId: { in: purchases.map((p) => p.id) } }, { landedCostId: { in: landed.map((l) => l.id) } }, { openingDebtId: { in: openings.map((o) => o.id) } }],
    },
    select: { purchaseId: true, landedCostId: true, openingDebtId: true, settledInPurchaseCcy: true },
  })
  const returned = await returnedOffsets(db, purchases.map((p) => p.id))
  // settled per document (a payment names exactly one of purchase, landed cost, opening debt)
  const settled = new Map<string, DD>()
  for (const r of paid) {
    const id = (r.purchaseId ?? r.landedCostId ?? r.openingDebtId)!
    settled.set(id, (settled.get(id) ?? new D(0)).plus(dec(r.settledInPurchaseCcy)))
  }
  const paidOf = (id: string) => (settled.get(id) ?? new D(0)).plus(returned.get(id) ?? new D(0))
  const docs: Payable[] = [
    ...openings.map((o) => ({
      kind: 'OPENING' as const,
      id: o.id,
      supplierId: o.supplierId!,
      number: null,
      currency: o.currency,
      amount: dec(o.amount),
      open: dec(o.amount).minus(paidOf(o.id)),
      lockedRate: dec(o.rateIqd),
      date: isoOf(o.date),
      dueDate: null,
      createdAt: o.createdAt,
    })),
    ...purchases.map((p) => ({
      kind: 'PURCHASE' as const,
      id: p.id,
      supplierId: p.supplierId,
      number: p.number,
      currency: p.currency,
      amount: dec(p.totalOriginal),
      open: dec(p.totalOriginal).minus(paidOf(p.id)),
      lockedRate: snapshotRate(p.rateSnapshot, p.currency),
      date: isoOf(p.date),
      dueDate: p.dueDate ? isoOf(p.dueDate) : null,
      createdAt: p.createdAt,
    })),
    ...landed.map((l) => ({
      kind: 'LANDED_COST' as const,
      id: l.id,
      supplierId: l.supplierId!,
      number: null,
      currency: l.currency,
      amount: dec(l.amount),
      open: dec(l.amount).minus(paidOf(l.id)),
      lockedRate: snapshotRate(l.rateSnapshot, l.currency),
      date: isoOf(l.date),
      dueDate: null,
      createdAt: l.createdAt,
    })),
  ]
  // FIFO: due date (a document without one is due on its own date), then date, then entry order
  return docs.sort((a, b) => {
    const da = a.dueDate ?? a.date
    const db_ = b.dueDate ?? b.date
    return da < db_ ? -1 : da > db_ ? 1 : a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.getTime() - b.createdAt.getTime()
  })
}

export type SupplierPaymentInput = { supplierId: string; amount: Dec; currency: Currency; date: string; purchaseId?: string | null }

/** paySupplier inside the caller's transaction. Returns the journal entry id. */
export async function paySupplierTx(tx: Db, rid: string, user: SessionUser, p: SupplierPaymentInput): Promise<{ entryId: string }> {
  if (!p || typeof p !== 'object') throw new InvalidPurchaseError('payment is required')
  const supplierId = requireId(p.supplierId, 'supplier')
  if (!isCurrency(p.currency)) throw new InvalidPurchaseError(`unknown currency: ${String(p.currency)}`)
  const amount = parseAmount(p.amount, { label: 'amount', dp: AMOUNT_DP, min: 'positive' })
  const date = requireDocDate(p.date, 'date')
  const purchaseId = p.purchaseId ? requireId(p.purchaseId, 'purchase') : undefined

  // The supplier row lock serialises payments to one supplier (no double-spend of an open balance) and cancellations.
  if (!(await lockRow(tx, rid, 'Supplier', supplierId))) throw new InvalidPurchaseError('unknown supplier')
  if (purchaseId) {
    const target = await tx.whPurchase.findUnique({ where: { id: purchaseId }, select: { supplierId: true, paymentMode: true, status: true, date: true } })
    if (!target || target.supplierId !== supplierId) throw new InvalidPurchaseError('the purchase is not one of this supplier')
    if (date < isoOf(target.date)) throw new InvalidPurchaseError('a payment cannot be dated before its purchase')
    if (target.paymentMode !== 'CREDIT') throw new InvalidPurchaseError('a cash purchase has nothing to pay')
    if (target.status !== 'POSTED') throw new InvalidPurchaseError('the purchase is cancelled')
  }
  await assertPeriodOpen(tx, rid, date)
  const docs = await payables(tx, supplierId, purchaseId)
  // a payment never settles a document dated after it (FIFO without purchaseId skips those), as customer payments
  const open = docs.filter((x) => x.open.gt(0) && x.date <= date)
  // Rates only for the paid currency and the currencies of the documents this payment actually reaches: settle with
  // what we have, and when the FIFO walk reaches a document in a currency we have no rate for yet, load that day's
  // rate (requireRates throws RateMissingError if there is none) and settle again. At most three rounds.
  const wanted: Currency[] = [p.currency]
  let rates = await requireRates(tx, date, wanted)
  let settlements: ReturnType<typeof settlePayment>
  for (;;) {
    try {
      settlements = settlePayment(amount, p.currency, open, rates)
      break
    } catch (e) {
      if (!(e instanceof RateMissingError) || wanted.includes(e.currency)) throw e
      wanted.push(e.currency)
      rates = await requireRates(tx, date, wanted)
    }
  }
  const payRate = p.currency === 'IQD' ? new D(1) : new D(rates.iqdPer[p.currency]!)

  const rows = settlements.map((s) => {
    const doc = s.doc as Payable
    const apIqd = round4(s.settled.times(doc.lockedRate))
    const cashIqd = round4(s.paid.times(payRate))
    return { doc, settled: s.settled, paid: s.paid, fx: cashIqd.minus(apIqd) }
  })
  const fx = sum(rows.map((r) => r.fx))
  const lines: LineInput[] = rows.map((r) => ({
    accountCode: 'AP',
    side: 'DR',
    amount: r.settled,
    currency: r.doc.currency,
    partyId: supplierId,
    ...(r.doc.currency === 'IQD' ? {} : { rateIqd: r.doc.lockedRate }),
  }))
  if (fx.gt(0)) lines.push({ accountCode: 'FX_LOSS', side: 'DR', amount: fx, currency: 'IQD' })
  for (const r of rows) lines.push({ accountCode: cashAccount(p.currency), side: 'CR', amount: r.paid, currency: p.currency })
  if (fx.lt(0)) lines.push({ accountCode: 'FX_GAIN', side: 'CR', amount: fx.abs(), currency: 'IQD' })

  const paymentId = randomUUID()
  const { entryId } = await postJournal(tx, rid, { date, memo: `Payment to supplier`, source: { type: 'SUPPLIER_PAYMENT', id: paymentId }, user, lines })
  const snap = snapshotOf(rates, [p.currency, ...rows.map((r) => r.doc.currency)])
  for (const r of rows)
    await tx.whSupplierPayment.create({
      data: {
        restaurantId: rid,
        supplierId,
        purchaseId: r.doc.kind === 'PURCHASE' ? r.doc.id : null,
        landedCostId: r.doc.kind === 'LANDED_COST' ? r.doc.id : null,
        openingDebtId: r.doc.kind === 'OPENING' ? r.doc.id : null,
        amount: r.paid.toFixed(),
        currency: p.currency,
        date: toDbDate(date),
        settledInPurchaseCcy: r.settled.toFixed(),
        rateSnapshot: snap,
        fxDiffIqd: r.fx.toFixed(),
        journalEntryId: entryId,
        userId: user.id,
      },
    })
  return { entryId }
}

// ---------------------------------------------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------------------------------------------

/**
 * Cancel a purchase by reversal: allowed only while its stock is untouched in the receiving warehouse (no issue,
 * transfer out, adjustment or re-cost of its items there since its receipt) and it has no landed costs and no
 * payments; otherwise PurchaseNotCancellableError. Reverses its journal entry (dated today, see reverseJournal) and takes each
 * line's stock back out at the line's own cost (reverseReceipt), then marks the purchase CANCELLED.
 */
export async function cancelPurchaseTx(tx: Db, rid: string, user: SessionUser, purchaseId: string, reason: string): Promise<void> {
  if (typeof reason !== 'string' || !reason.trim()) throw new InvalidPurchaseError('a reason is required to cancel a purchase')
  const id = requireId(purchaseId, 'purchase')
  const head = await tx.whPurchase.findUnique({ where: { id }, select: { supplierId: true } })
  if (!head) throw new InvalidPurchaseError('unknown purchase')
  await lockRow(tx, rid, 'Supplier', head.supplierId)
  await lockRow(tx, rid, 'Purchase', id)
  const p = await tx.whPurchase.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
  if (p.status !== 'POSTED') throw new PurchaseStateError('the purchase is already cancelled')
  if (await tx.whLandedCost.count({ where: { purchaseId: id } })) throw new PurchaseNotCancellableError('the purchase has landed costs')
  if (await tx.whSupplierPayment.count({ where: { purchaseId: id } })) throw new PurchaseNotCancellableError('the purchase has payments')
  // goods already went back to the supplier (posting/purchaseReturn.ts): the DB refuses it too
  if (await tx.whPurchaseReturn.count({ where: { purchaseId: id } })) throw new PurchaseNotCancellableError('the purchase has returns')
  const itemIds = [...new Set(p.lines.map((l) => l.itemId))]
  // Lock first, so no movement can slip in between the check below and the reversal.
  await lockStockRows(tx, rid, itemIds.map((itemId) => ({ itemId, warehouseId: p.warehouseId })))
  // The stock must be untouched since it was received: no ISSUE, TRANSFER_OUT, ADJUST or RECOST of the item in the
  // receiving warehouse after this purchase's RECEIPT (by seq, the movement order). "On hand >= received" is not
  // enough: after sell-then-restock the units on hand are another purchase's, and reversing at this receipt's cost
  // would mis-value them. Later receipts (RECEIPT/TRANSFER_IN) are fine: the reversal is value-based. A RECOST from
  // another purchase's landed cost also blocks (conservative: it re-valued units this receipt is part of).
  const receipts = await tx.whStockMovement.findMany({
    where: { refType: 'PURCHASE', refId: id, type: 'RECEIPT', warehouseId: p.warehouseId },
    select: { itemId: true, seq: true },
  })
  for (const itemId of itemIds) {
    const seqs = receipts.filter((r) => r.itemId === itemId).map((r) => r.seq)
    if (!seqs.length) throw new Error(`purchase ${id} has no receipt movement for item ${itemId}`)
    const first = seqs.reduce((a, b) => (b < a ? b : a))
    const touched = await tx.whStockMovement.findFirst({
      where: { itemId, warehouseId: p.warehouseId, seq: { gt: first }, type: { in: ['ISSUE', 'TRANSFER_OUT', 'ADJUST', 'RECOST'] } },
      select: { type: true },
    })
    if (touched) throw new PurchaseNotCancellableError(`stock of this purchase was already moved or re-costed (${touched.type}) after it was received`)
  }
  const { entryId } = await reverseJournal(tx, rid, p.journalEntryId, user, reason.trim())
  const ref = { type: 'PURCHASE_CANCEL', id }
  for (const l of p.lines)
    await reverseReceipt(tx, { restaurantId: rid, itemId: l.itemId, warehouseId: p.warehouseId, qtyBase: dec(l.qtyBase), unitCostIqd: dec(l.unitCostIqd), expiry: l.expiry ? isoOf(l.expiry) : null, ref, user })
  await tx.whPurchase.update({ where: { id }, data: { status: 'CANCELLED', cancelEntryId: entryId, cancelReason: reason.trim(), cancelledAt: new Date() } })
}

// ---------------------------------------------------------------------------------------------------------------
// Reading (OWNER/PARTNER only: purchases carry cost)
// ---------------------------------------------------------------------------------------------------------------

export async function listPurchases(tx: Db) {
  const rows = await tx.whPurchase.findMany({
    orderBy: { number: 'desc' },
    take: 200,
    include: { supplier: { select: { id: true, name: true } } },
  })
  return rows.map((r) => ({ ...r, date: isoOf(r.date), dueDate: r.dueDate ? isoOf(r.dueDate) : null }))
}

/** One purchase with lines, landed costs (with allocations) and payments; `open` = what is still owed (credit only). */
export async function getPurchase(tx: Db, id: string) {
  const p = await tx.whPurchase.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { code: true, names: true } } } },
      landedCosts: { orderBy: { createdAt: 'asc' }, include: { allocations: true, supplier: { select: { name: true } } } },
      payments: { orderBy: { createdAt: 'asc' } },
      returns: { orderBy: { createdAt: 'asc' }, include: { lines: true } },
    },
  })
  if (!p) return null
  const paid = sum(p.payments.map((x) => dec(x.settledInPurchaseCcy)))
  const returnedOff = sum(p.returns.filter((r) => r.refund === 'DEBT_OFFSET').map((r) => dec(r.totalValue)))
  return {
    ...p,
    date: isoOf(p.date),
    dueDate: p.dueDate ? isoOf(p.dueDate) : null,
    lines: p.lines.map((l) => ({ ...l, itemNames: l.item.names as Names, expiry: l.expiry ? isoOf(l.expiry) : null })),
    landedCosts: p.landedCosts.map((l) => ({ ...l, date: isoOf(l.date) })),
    payments: p.payments.map((x) => ({ ...x, date: isoOf(x.date) })),
    returns: p.returns.map((r) => ({ ...r, date: isoOf(r.date) })),
    paidInPurchaseCcy: paid,
    /** Goods returned to the supplier against this purchase's debt (DEBT_OFFSET), in the purchase currency. */
    returnedOffInPurchaseCcy: returnedOff,
    open: p.paymentMode === 'CREDIT' && p.status === 'POSTED' ? dec(p.totalOriginal).minus(paid).minus(returnedOff) : new D(0),
  }
}

export type StatementRow = {
  date: string
  kind: 'PURCHASE' | 'LANDED_COST' | 'PAYMENT' | 'CANCEL' | 'RETURN' | 'OPENING'
  /** Purchase id (also for a landed cost, payment, return or cancellation of a purchase); null for a landed-cost or opening-debt payment. */
  purchaseId: string | null
  purchaseNumber: string | null
  currency: Currency
  /** Increase of what we owe, in `currency`. */
  charge: Decimal
  /** Decrease of what we owe, in `currency` (a payment: the part of the document it settled). */
  paid: Decimal
  /** What was actually handed over, for a payment (may be another currency). */
  paidAmount: Decimal | null
  paidCurrency: Currency | null
  /** Running balance in `currency` after this row. */
  balance: Decimal
}

/**
 * The supplier's account in the currencies of its documents: opening debts, credit purchases, credit landed costs
 * payable to it, payments (one row per settled document), returns offset against a purchase's debt and
 * cancellations, chronological, with a running balance per currency.
 */
export async function supplierStatement(tx: Db, supplierId: string): Promise<{ rows: StatementRow[]; balances: Partial<Record<Currency, Decimal>> }> {
  const [purchases, landed, payments, openings, returns] = await Promise.all([
    tx.whPurchase.findMany({ where: { supplierId, paymentMode: 'CREDIT' }, include: { cancelEntry: { select: { date: true } } } }),
    tx.whLandedCost.findMany({ where: { supplierId, paymentMode: 'CREDIT' }, include: { purchase: { select: { number: true } } } }),
    tx.whSupplierPayment.findMany({
      where: { supplierId },
      include: {
        purchase: { select: { number: true, currency: true } },
        landedCost: { select: { currency: true, purchaseId: true, purchase: { select: { number: true } } } },
        openingDebt: { select: { currency: true } },
      },
    }),
    tx.whOpeningDebt.findMany({ where: { supplierId }, orderBy: [{ createdAt: 'asc' }, { lineNo: 'asc' }] }),
    tx.whPurchaseReturn.findMany({ where: { refund: 'DEBT_OFFSET', purchase: { supplierId } }, include: { purchase: { select: { number: true } } } }),
  ])
  type Raw = Omit<StatementRow, 'balance'> & { at: Date; order: number }
  const zero = new D(0)
  const raw: Raw[] = []
  for (const o of openings)
    raw.push({ date: isoOf(o.date), at: o.createdAt, order: 0, kind: 'OPENING', purchaseId: null, purchaseNumber: null, currency: o.currency, charge: dec(o.amount), paid: zero, paidAmount: null, paidCurrency: null })
  for (const r of returns)
    raw.push({ date: isoOf(r.date), at: r.createdAt, order: 2, kind: 'RETURN', purchaseId: r.purchaseId, purchaseNumber: r.purchase.number.toString(), currency: r.currency, charge: zero, paid: dec(r.totalValue), paidAmount: null, paidCurrency: null })
  for (const p of purchases) {
    raw.push({ date: isoOf(p.date), at: p.createdAt, order: 0, kind: 'PURCHASE', purchaseId: p.id, purchaseNumber: p.number.toString(), currency: p.currency, charge: dec(p.totalOriginal), paid: zero, paidAmount: null, paidCurrency: null })
    if (p.status === 'CANCELLED' && p.cancelEntry)
      raw.push({ date: isoOf(p.cancelEntry.date), at: p.cancelledAt ?? p.createdAt, order: 3, kind: 'CANCEL', purchaseId: p.id, purchaseNumber: p.number.toString(), currency: p.currency, charge: zero, paid: dec(p.totalOriginal), paidAmount: null, paidCurrency: null })
  }
  for (const l of landed)
    raw.push({ date: isoOf(l.date), at: l.createdAt, order: 1, kind: 'LANDED_COST', purchaseId: l.purchaseId, purchaseNumber: l.purchase.number.toString(), currency: l.currency, charge: dec(l.amount), paid: zero, paidAmount: null, paidCurrency: null })
  for (const x of payments) {
    const currency = (x.purchase?.currency ?? x.landedCost?.currency ?? x.openingDebt?.currency)!
    const number = x.purchase?.number ?? x.landedCost?.purchase.number
    raw.push({
      date: isoOf(x.date),
      at: x.createdAt,
      order: 2,
      kind: 'PAYMENT',
      purchaseId: x.purchaseId ?? x.landedCost?.purchaseId ?? null,
      purchaseNumber: number?.toString() ?? null,
      currency,
      charge: zero,
      paid: dec(x.settledInPurchaseCcy),
      paidAmount: dec(x.amount),
      paidCurrency: x.currency,
    })
  }
  raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at.getTime() - b.at.getTime() || a.order - b.order))
  const balances: Partial<Record<Currency, DD>> = {}
  const rows: StatementRow[] = raw.map((r) => {
    const b = (balances[r.currency] ?? new D(0)).plus(r.charge).minus(r.paid)
    balances[r.currency] = b
    const { date, kind, purchaseId, purchaseNumber, currency, charge, paid, paidAmount, paidCurrency } = r
    return { date, kind, purchaseId, purchaseNumber, currency, charge, paid, paidAmount, paidCurrency, balance: b }
  })
  return { rows, balances }
}

/** Suppliers' open credit documents (for the payment form): what is still owed per document. */
export async function openPayables(tx: Db, supplierId: string) {
  return (await payables(tx, supplierId)).filter((d) => d.open.gt(0))
}

/**
 * Every supplier's (or one supplier's) credit documents with their open amounts, the same computation as the payment
 * form uses (payables). No permission check: the caller (the payables report) checks accounts:view.
 */
export function payableDocs(db: Db, supplierId: string | null): Promise<Payable[]> {
  return payables(db, supplierId)
}
