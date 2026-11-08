import { randomUUID } from 'node:crypto'
import type Decimal from 'decimal.js'
import type { ScopedTx } from '@/server/data/tenant-db'
import { QTY_DP, roundCost } from '@/server/domain/wholesale/costing'
import type { LineInput } from '@/server/domain/wholesale/ledger'
import { D } from '@/server/domain/wholesale/money'
import { InvalidPurchaseError, PurchaseStateError, parseAmount, round4, snapshotRate } from '@/server/domain/wholesale/purchase'
import { baghdadDate, type Currency } from '@/server/domain/wholesale/rates'
import { postJournal } from '@/server/wholesale/ledger'
import { assertPeriodOpen } from '@/server/wholesale/period'
import { lockPurchase, returnedOffsets } from '@/server/wholesale/posting/purchase'
import { lockStockRows, reverseReceipt } from '@/server/wholesale/stock'

/*
 * Purchase returns: goods of a POSTED purchase sent back to its supplier (purchase:return, OWNER/PARTNER). One
 * transaction: validate -> lock supplier + purchase (lockPurchase; payments to the supplier and other returns of the
 * purchase wait) -> read what was already returned -> period open -> stock locks -> stock out -> journal -> rows ->
 * audit. Any failure rolls everything back.
 *
 * Quantities: `qty` is in the purchase line's unit (qtyBase = qty x the line's own qtyBase/qty; the last part is
 * exactly what is left). All the returns of a line never exceed what it bought (InvalidPurchaseError; a DB trigger
 * refuses it too).
 *
 * Value (all at the purchase's LOCKED rate, rateSnapshot, pinned on the journal lines: no rate row is needed):
 * - The supplier's credit = the goods only: each part's share of the line total at the purchase price (cumulative
 *   rounding like sale returns, so the returns of a line add up exactly to its lineTotal). Freight, customs and other
 *   landed costs are not refunded by the supplier.
 * - Stock leaves the receiving warehouse at the line's ORIGINAL cost plus its share of the purchase's landed costs
 *   (unitCostIqd + sum of the line's LandedCostAllocation IQD / qtyBase, 8 dp), through reverseReceipt: the remaining
 *   stock is valued as if these units had never arrived. Not enough on hand (the goods were sold, moved or written
 *   off) -> InsufficientStockError: the return is refused. Expiry: the line's own expiry batch first, then oldest
 *   expiry first (reverseReceipt).
 * - Journal (source PURCHASE_RETURN): CR INVENTORY with the stock value taken out; DR the refund side with the goods'
 *   value; DR PURCHASE_RETURN_LOSS with the landed-cost part (inventory value minus the goods at the line cost); the
 *   sub-fils gap between the goods at line cost and the credit at the locked rate goes to ROUNDING (as postPurchase).
 *
 * Refund: DEBT_OFFSET (default for a credit purchase) = DR AP (party = the supplier), reducing THAT purchase's open
 * balance (payables, getPurchase, supplier statement). The model has no supplier credit balance (as sale returns have
 * no customer credit): a debt offset above what is still open on the purchase is refused, and a cash purchase can only
 * be refunded in cash. CASH (default for a cash purchase) = DR CASH_<purchase currency>: the supplier pays the goods'
 * value back, valued at the purchase's locked rate (no FX line).
 *
 * Date: always today (Asia/Baghdad), like a stock count: the goods leave the stock now, so the entry cannot be dated
 * earlier than the movement (a `date` field is refused). Never before the purchase; the month must be open. A purchase
 * with returns can no longer be cancelled (cancelPurchase and a DB trigger refuse it).
 */

type Db = ScopedTx
type SessionUser = { id: string }
type DD = InstanceType<typeof D>
type Dec = Decimal | string

export const PURCHASE_REFUNDS = ['CASH', 'DEBT_OFFSET'] as const
export type PurchaseRefund = (typeof PURCHASE_REFUNDS)[number]
export type PurchaseReturnInput = {
  purchaseId: string
  lines: { purchaseLineId: string; qty: Dec }[]
  /** Default: DEBT_OFFSET for a credit purchase, CASH for a cash purchase. */
  refund?: PurchaseRefund | null
}

const MAX_LINES = 500
const QTY_MAX = new D(10).pow(24 - QTY_DP)
const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`)
const isoOf = (d: Date): string => d.toISOString().slice(0, 10)
const dec = (v: { toString(): string }): DD => new D(v.toString())
const sum = (xs: DD[]): DD => xs.reduce((a, b) => a.plus(b), new D(0))

function cleanInput(input: PurchaseReturnInput) {
  if (!input || typeof input !== 'object') throw new InvalidPurchaseError('return is required')
  if (typeof input.purchaseId !== 'string' || !input.purchaseId.trim()) throw new InvalidPurchaseError('purchase is required')
  if (input.refund !== undefined && input.refund !== null && !(PURCHASE_REFUNDS as readonly string[]).includes(input.refund))
    throw new InvalidPurchaseError(`unknown refund mode: ${String(input.refund)}`)
  if ('date' in input && (input as { date?: unknown }).date !== undefined) throw new InvalidPurchaseError('a purchase return is always dated today')
  const date = baghdadDate()
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new InvalidPurchaseError('a return needs at least one line')
  if (input.lines.length > MAX_LINES) throw new InvalidPurchaseError(`a return has at most ${MAX_LINES} lines`)
  const seen = new Set<string>()
  const lines = input.lines.map((l, i) => {
    const at = `return line ${i + 1}`
    if (!l || typeof l !== 'object') throw new InvalidPurchaseError(`${at}: not a line`)
    if (typeof l.purchaseLineId !== 'string' || !l.purchaseLineId.trim()) throw new InvalidPurchaseError(`${at}: purchase line is required`)
    const purchaseLineId = l.purchaseLineId.trim()
    if (seen.has(purchaseLineId)) throw new InvalidPurchaseError(`${at}: the same purchase line twice`)
    seen.add(purchaseLineId)
    return { at, purchaseLineId, qty: parseAmount(l.qty, { label: `${at}: quantity`, dp: QTY_DP, min: 'positive', max: QTY_MAX }) }
  })
  return { purchaseId: input.purchaseId.trim(), refund: input.refund ?? null, date, lines }
}

/** postPurchaseReturn inside the caller's transaction. */
export async function postPurchaseReturnTx(tx: Db, rid: string, user: SessionUser, input: PurchaseReturnInput): Promise<{ returnId: string }> {
  const inp = cleanInput(input)
  await lockPurchase(tx, rid, inp.purchaseId)
  const p = await tx.whPurchase.findUniqueOrThrow({
    where: { id: inp.purchaseId },
    include: { supplier: { select: { name: true } }, lines: { include: { allocations: { select: { iqdToInventory: true, iqdToCogs: true } } } } },
  })
  if (p.status !== 'POSTED') throw new PurchaseStateError('the purchase is cancelled')
  if (inp.date < isoOf(p.date)) throw new InvalidPurchaseError('a return cannot be dated before its purchase')
  const refund: PurchaseRefund = inp.refund ?? (p.paymentMode === 'CREDIT' ? 'DEBT_OFFSET' : 'CASH')
  if (refund === 'DEBT_OFFSET' && p.paymentMode !== 'CREDIT') throw new InvalidPurchaseError('a cash purchase has no debt to offset: refund in cash')
  await assertPeriodOpen(tx, rid, inp.date)
  const rate = snapshotRate(p.rateSnapshot, p.currency)

  // what every line has already given back
  const earlier = await tx.whPurchaseReturnLine.findMany({ where: { purchaseLine: { purchaseId: p.id } }, select: { purchaseLineId: true, qty: true, qtyBase: true } })
  const lineById = new Map(p.lines.map((l) => [l.id, l]))
  const lines = inp.lines.map((r) => {
    const l = lineById.get(r.purchaseLineId)
    if (!l) throw new InvalidPurchaseError(`${r.at}: not a line of this purchase`)
    const bought = dec(l.qty)
    const mine = earlier.filter((e) => e.purchaseLineId === l.id)
    const before = sum(mine.map((e) => dec(e.qty)))
    const baseBefore = sum(mine.map((e) => dec(e.qtyBase)))
    const after = before.plus(r.qty)
    if (after.gt(bought)) throw new InvalidPurchaseError(`${r.at}: only ${bought.minus(before).toFixed()} ${l.unit} of this line is left to return`)
    const qtyBase = after.eq(bought) ? dec(l.qtyBase).minus(baseBefore) : r.qty.times(dec(l.qtyBase)).div(bought)
    if (qtyBase.decimalPlaces() > QTY_DP) throw new InvalidPurchaseError(`${r.at}: quantity in the base unit has more than ${QTY_DP} decimal places`)
    if (!qtyBase.gt(0)) throw new InvalidPurchaseError(`${r.at}: nothing left to return`)
    const price = dec(l.unitPrice)
    const lineTotal = (after.eq(bought) ? dec(l.lineTotal) : round4(after.times(price))).minus(round4(before.times(price)))
    const landed = sum(l.allocations.map((a) => dec(a.iqdToInventory).plus(dec(a.iqdToCogs))))
    const lineCost = dec(l.unitCostIqd)
    const unitCost = roundCost(lineCost.plus(landed.div(dec(l.qtyBase))))
    return { ...r, line: l, qtyBase, lineTotal, lineCost, unitCost }
  })
  const value = sum(lines.map((l) => l.lineTotal))
  if (!value.gt(0)) throw new InvalidPurchaseError('the returned goods are worth nothing at the purchase price')

  if (refund === 'DEBT_OFFSET') {
    const paid = sum((await tx.whSupplierPayment.findMany({ where: { purchaseId: p.id }, select: { settledInPurchaseCcy: true } })).map((x) => dec(x.settledInPurchaseCcy)))
    const open = dec(p.totalOriginal).minus(paid).minus((await returnedOffsets(tx, [p.id])).get(p.id) ?? new D(0))
    if (value.gt(open))
      throw new InvalidPurchaseError(`the supplier is owed only ${open.toFixed()} ${p.currency} on this purchase, less than the ${value.toFixed()} returned: refund in cash`)
  }

  const returnId = randomUUID()
  const ref = { type: 'PURCHASE_RETURN', id: returnId }
  await lockStockRows(tx, rid, lines.map((l) => ({ itemId: l.line.itemId, warehouseId: p.warehouseId })))
  for (const l of lines)
    await reverseReceipt(tx, {
      restaurantId: rid,
      itemId: l.line.itemId,
      warehouseId: p.warehouseId,
      qtyBase: l.qtyBase,
      unitCostIqd: l.unitCost,
      expiry: l.line.expiry ? isoOf(l.line.expiry) : null,
      ref,
      user,
    })

  const inventoryIqd = round4(sum(lines.map((l) => l.qtyBase.times(l.unitCost))))
  const goodsAtCost = round4(sum(lines.map((l) => l.qtyBase.times(l.lineCost))))
  const landedLoss = inventoryIqd.minus(goodsAtCost)
  const goodsIqd = round4(value.times(rate))
  const gap = goodsAtCost.minus(goodsIqd)
  // 8-dp stored costs and two 4-dp roundings: never near 1 IQD unless something is broken (as postPurchase)
  if (gap.abs().gte(1)) throw new Error(`purchase return ${returnId}: goods at cost ${goodsAtCost.toFixed()} vs credit ${goodsIqd.toFixed()} IQD`)

  const pin = (c: Currency) => (c === 'IQD' ? {} : { rateIqd: rate })
  const journal: LineInput[] = [
    refund === 'DEBT_OFFSET'
      ? { accountCode: 'AP', side: 'DR', amount: value, currency: p.currency, partyId: p.supplierId, ...pin(p.currency) }
      : { accountCode: `CASH_${p.currency}`, side: 'DR', amount: value, currency: p.currency, ...pin(p.currency) },
  ]
  if (landedLoss.gt(0)) journal.push({ accountCode: 'PURCHASE_RETURN_LOSS', side: 'DR', amount: landedLoss, currency: 'IQD' })
  if (gap.gt(0)) journal.push({ accountCode: 'ROUNDING', side: 'DR', amount: gap, currency: 'IQD' })
  if (inventoryIqd.gt(0)) journal.push({ accountCode: 'INVENTORY', side: 'CR', amount: inventoryIqd, currency: 'IQD' })
  if (gap.lt(0)) journal.push({ accountCode: 'ROUNDING', side: 'CR', amount: gap.abs(), currency: 'IQD' })
  const { entryId } = await postJournal(tx, rid, { date: inp.date, memo: `Return to ${p.supplier.name} of purchase #${p.number}`, source: ref, user, lines: journal })

  await tx.whPurchaseReturn.create({
    data: {
      id: returnId,
      restaurantId: rid,
      purchaseId: p.id,
      date: toDbDate(inp.date),
      currency: p.currency,
      refund,
      rateIqd: rate.toFixed(),
      totalValue: value.toFixed(),
      inventoryIqd: inventoryIqd.toFixed(),
      landedLossIqd: landedLoss.toFixed(),
      journalEntryId: entryId,
      userId: user.id,
      lines: {
        create: lines.map((l, i) => ({
          restaurantId: rid,
          lineNo: i + 1,
          purchaseLineId: l.line.id,
          qty: l.qty.toFixed(),
          qtyBase: l.qtyBase.toFixed(),
          unitCostIqd: l.unitCost.toFixed(),
          lineTotal: l.lineTotal.toFixed(),
        })),
      },
    },
    select: { number: true },
  })
  return { returnId }
}

