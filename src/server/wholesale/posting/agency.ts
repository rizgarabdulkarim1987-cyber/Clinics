/* eslint-disable no-restricted-properties -- row locks of one company: every statement binds "restaurantId" (the company's own id) */
import { randomUUID } from 'node:crypto'
import type Decimal from 'decimal.js'
import type { ScopedTx } from '@/server/data/tenant-db'
import { COST_CATEGORIES, InvalidAgencyError, agencyBalance, nextStatusAfterCollection, planSettlement, type AgencyBalance, type AgencyKind } from '@/server/domain/wholesale/agency'
import { AMOUNT_DP, type LineInput } from '@/server/domain/wholesale/ledger'
import { D } from '@/server/domain/wholesale/money'
import { ForbiddenError, canWh, type WhRole } from '@/server/domain/wholesale/permissions'
import { isCurrency, parseAmount } from '@/server/domain/wholesale/purchase'
import { isIsoDate, type Currency } from '@/server/domain/wholesale/rates'
import { assertNotFuture } from '@/server/wholesale/clock'
import { postJournal } from '@/server/wholesale/ledger'

export { InvalidAgencyError } from '@/server/domain/wholesale/agency'

/*
 * Special orders (agency orders): a customer asks the company to bring goods from abroad, pays an advance, and takes the
 * goods and pays the whole total on arrival. OWNER and PARTNER only (catalog.manage).
 *
 * Journal rules (one currency per order, so no FX line; amounts are posted at the day's rate like any foreign line):
 * - Advance:    DR CASH_<c> (or REP_CUSTODY, party = the rep) / CR CUSTOMER_ADVANCES (party = customer)
 * - Cost paid:  DR AGENCY_WIP / CR CASH_<c>           (what the company pays to get the goods: price abroad, shipping...)
 * - Delivery:   CR SALES (the final total); DR COGS / CR AGENCY_WIP (the cost paid); DR CUSTOMER_ADVANCES (advances applied);
 *               DR AGENCY_RECEIVABLE (what is still owed); and if the advances exceed the total, DR CUSTOMER_ADVANCES / CR cash
 * - Payment:    DR CASH_<c> (or REP_CUSTODY) / CR AGENCY_RECEIVABLE   (the customer pays the rest later)
 * So the sale shows in SALES and COGS like any sale and the profit report gives its profit or loss (total - cost). The
 * goods never enter INVENTORY. The order's own rows (WhAgencyMovement) repeat each step so its balance and profit read
 * without the ledger; both are written in one transaction. AGENCY_RECEIVABLE is separate from AR (the debts total adds
 * both), so the customer's sale statement and FIFO payments are untouched.
 *
 * States: OPEN -> DELIVERED (delivered, something still owed) -> CLOSED (nothing owed). OPEN -> CANCELLED only before
 * any cost is paid; held advances are paid back from the till. Locks: the order row FOR NO KEY UPDATE.
 */

type Db = ScopedTx
type WhUser = { id: string; role: WhRole }
type Dec = Decimal | string

const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`)
const dec = (v: { toString(): string }): Decimal => new D(v.toString())
const cashAccount = (c: Currency) => `CASH_${c}`

function requireManager(user: WhUser): void {
  if (!canWh(user.role, 'catalog.manage')) throw new ForbiddenError('catalog:manage')
}

function requireText(v: unknown, label: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new InvalidAgencyError(`${label} is required`)
  if (v.trim().length > max) throw new InvalidAgencyError(`${label} is too long`)
  return v.trim()
}

function optionalText(v: unknown, max: number): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') throw new InvalidAgencyError('note must be text')
  return v.trim().slice(0, max) || null
}

function requireDay(v: unknown, label: string): string {
  if (!isIsoDate(v)) throw new InvalidAgencyError(`${label} must be a date (YYYY-MM-DD)`)
  assertNotFuture(v)
  return v
}

const positive = (v: unknown, label: string): Decimal => parseAmount(v, { label, dp: AMOUNT_DP, min: 'positive' })

async function lockOrder(tx: Db, rid: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "WhAgencyOrder" WHERE id = ${id} AND "restaurantId" = ${rid} FOR NO KEY UPDATE`
  if (rows.length === 0) throw new InvalidAgencyError('unknown order')
  return tx.whAgencyOrder.findUniqueOrThrow({ where: { id }, include: { movements: { select: { kind: true, amount: true } } } })
}

const balanceOf = (order: { movements: { kind: AgencyKind; amount: { toString(): string } }[] }): AgencyBalance =>
  agencyBalance(order.movements.map((m) => ({ kind: m.kind, amount: dec(m.amount) })))

/** Where received money lands: the till, or a rep's custody when a rep took it. */
async function receiving(tx: Db, custodyRepId: unknown, currency: Currency, amount: Decimal): Promise<{ line: LineInput; repId: string | null }> {
  if (custodyRepId === undefined || custodyRepId === null || custodyRepId === '') return { line: { accountCode: cashAccount(currency), side: 'DR', amount, currency }, repId: null }
  if (typeof custodyRepId !== 'string') throw new InvalidAgencyError('rep is not valid')
  const rep = await tx.whStaff.findFirst({ where: { userId: custodyRepId, role: 'REP', deactivatedAt: null }, select: { userId: true } })
  if (!rep) throw new InvalidAgencyError('the money can only go to an active rep')
  return { line: { accountCode: 'REP_CUSTODY', side: 'DR', amount, currency, partyId: custodyRepId }, repId: custodyRepId }
}

async function addRows(
  tx: Db,
  rid: string,
  order: { id: string; currency: Currency },
  user: WhUser,
  entryId: string,
  date: string,
  rows: { kind: AgencyKind; amount: Decimal; category?: string | null; note?: string | null; custodyRepId?: string | null }[],
) {
  for (const r of rows)
    await tx.whAgencyMovement.create({
      data: { restaurantId: rid, orderId: order.id, kind: r.kind, amount: r.amount.toFixed(), currency: order.currency, date: toDbDate(date), note: r.note ?? null, category: r.category ?? null, custodyRepId: r.custodyRepId ?? null, journalEntryId: entryId, userId: user.id },
    })
}

// ---------------------------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------------------------

export type AgencyOrderInput = {
  principalId: string
  title: string
  note?: string | null
  currency: Currency
  agreedTotal: Dec
  date: string
  /** An advance taken when the order is opened: into the till, or a rep's custody. */
  advance?: { amount: Dec; custodyRepId?: string | null } | null
}

export async function createAgencyOrderTx(tx: Db, rid: string, user: WhUser, p: AgencyOrderInput): Promise<{ orderId: string }> {
  requireManager(user)
  if (!p || typeof p !== 'object') throw new InvalidAgencyError('order is required')
  const principal = await tx.whCustomer.findUnique({ where: { id: String(p.principalId ?? '') }, select: { id: true, active: true } })
  if (!principal) throw new InvalidAgencyError('unknown principal')
  if (!principal.active) throw new InvalidAgencyError('the principal is archived')
  if (!isCurrency(p.currency)) throw new InvalidAgencyError(`unknown currency: ${String(p.currency)}`)
  const order = await tx.whAgencyOrder.create({
    data: {
      restaurantId: rid,
      principalId: principal.id,
      title: requireText(p.title, 'title', 200),
      note: optionalText(p.note, 2000),
      currency: p.currency,
      agreedTotal: parseAmount(p.agreedTotal, { label: 'agreed total', dp: AMOUNT_DP, min: 'zero' }).toFixed(),
      date: toDbDate(requireDay(p.date, 'date')),
      createdById: user.id,
    },
    select: { id: true },
  })
  if (p.advance && p.advance.amount !== '' && p.advance.amount !== undefined) await receiveAdvanceTx(tx, rid, user, { orderId: order.id, amount: p.advance.amount, date: p.date, custodyRepId: p.advance.custodyRepId ?? null })
  return { orderId: order.id }
}

// ---------------------------------------------------------------------------------------------------------------
// Advance, cost, settlement, collection, cancellation
// ---------------------------------------------------------------------------------------------------------------

export type AdvanceInput = { orderId: string; amount: Dec; date: string; custodyRepId?: string | null; note?: string | null }

/** Money received from the principal in advance: DR till or custody, CR CUSTOMER_ADVANCES. */
export async function receiveAdvanceTx(tx: Db, rid: string, user: WhUser, p: AdvanceInput): Promise<{ entryId: string }> {
  requireManager(user)
  const order = await lockOrder(tx, rid, String(p?.orderId ?? ''))
  if (order.status !== 'OPEN') throw new InvalidAgencyError('advances are taken while the order is open')
  const amount = positive(p.amount, 'amount')
  const date = requireDay(p.date, 'date')
  const to = await receiving(tx, p.custodyRepId, order.currency, amount)
  const { entryId } = await postJournal(tx, rid, {
    date,
    memo: `Advance for special order #${order.number}`,
    source: { type: 'AGENCY_ADVANCE', id: randomUUID() },
    user,
    lines: [to.line, { accountCode: 'CUSTOMER_ADVANCES', side: 'CR', amount, currency: order.currency, partyId: order.principalId }],
  })
  await addRows(tx, rid, order, user, entryId, date, [{ kind: 'ADVANCE', amount, note: optionalText(p.note, 500), custodyRepId: to.repId }])
  return { entryId }
}

export type CostInput = { orderId: string; amount: Dec; date: string; category?: string | null; note?: string | null }

/** Money the company paid out of the till to get the goods (price abroad, shipping...): held as orders in progress until delivery. */
export async function payCostTx(tx: Db, rid: string, user: WhUser, p: CostInput): Promise<{ entryId: string }> {
  requireManager(user)
  const order = await lockOrder(tx, rid, String(p?.orderId ?? ''))
  if (order.status !== 'OPEN') throw new InvalidAgencyError('costs are recorded while the order is open')
  const amount = positive(p.amount, 'amount')
  const date = requireDay(p.date, 'date')
  const category = p.category ?? 'GOODS'
  if (!(COST_CATEGORIES as readonly string[]).includes(category)) throw new InvalidAgencyError('unknown cost kind')
  const { entryId } = await postJournal(tx, rid, {
    date,
    memo: `Paid for special order #${order.number}`,
    source: { type: 'AGENCY_COST', id: randomUUID() },
    user,
    lines: [
      { accountCode: 'AGENCY_WIP', side: 'DR', amount, currency: order.currency },
      { accountCode: cashAccount(order.currency), side: 'CR', amount, currency: order.currency },
    ],
  })
  await addRows(tx, rid, order, user, entryId, date, [{ kind: 'COST', amount, category, note: optionalText(p.note, 500) }])
  return { entryId }
}

export type SettleInput = { orderId: string; total: Dec; date: string; /** Money the customer pays right now at delivery: it goes into the till (or a rep's custody). */ receivedNow?: Dec | null; custodyRepId?: string | null }
export type SettleResult = { entryId: string; total: string; cost: string; profit: string; applied: string; refund: string; remaining: string; status: 'DELIVERED' | 'CLOSED' }

/** Delivery: the final total is the sale; advances pay part of it, the rest is owed; the cost paid becomes the cost of goods. */
export async function settleAgencyOrderTx(tx: Db, rid: string, user: WhUser, p: SettleInput): Promise<SettleResult> {
  requireManager(user)
  const order = await lockOrder(tx, rid, String(p?.orderId ?? ''))
  if (order.status !== 'OPEN') throw new InvalidAgencyError('only an open order can be delivered')
  const total = positive(p.total, 'total')
  const date = requireDay(p.date, 'date')
  const plan = planSettlement(balanceOf(order), total)
  const c = order.currency
  const party = order.principalId
  const lines: LineInput[] = [{ accountCode: 'SALES', side: 'CR', amount: plan.total, currency: c }]
  if (plan.cost.gt(0)) {
    lines.push({ accountCode: 'COGS', side: 'DR', amount: plan.cost, currency: c })
    lines.push({ accountCode: 'AGENCY_WIP', side: 'CR', amount: plan.cost, currency: c })
  }
  if (plan.applied.gt(0)) lines.push({ accountCode: 'CUSTOMER_ADVANCES', side: 'DR', amount: plan.applied, currency: c, partyId: party })
  if (plan.remaining.gt(0)) lines.push({ accountCode: 'AGENCY_RECEIVABLE', side: 'DR', amount: plan.remaining, currency: c, partyId: party })
  if (plan.refund.gt(0)) {
    lines.push({ accountCode: 'CUSTOMER_ADVANCES', side: 'DR', amount: plan.refund, currency: c, partyId: party })
    lines.push({ accountCode: cashAccount(c), side: 'CR', amount: plan.refund, currency: c })
  }
  const { entryId } = await postJournal(tx, rid, { date, memo: `Delivery of special order #${order.number}`, source: { type: 'AGENCY_SETTLEMENT', id: order.id }, user, lines })
  const rows: { kind: AgencyKind; amount: Decimal }[] = [{ kind: 'SALE', amount: plan.total }]
  if (plan.applied.gt(0)) rows.push({ kind: 'APPLIED', amount: plan.applied })
  if (plan.refund.gt(0)) rows.push({ kind: 'REFUND', amount: plan.refund })
  await addRows(tx, rid, order, user, entryId, date, rows)
  let status = nextStatusAfterCollection(plan.remaining) as 'DELIVERED' | 'CLOSED'
  await tx.whAgencyOrder.update({ where: { id: order.id }, data: { status, settledAt: new Date() } })
  let remaining = plan.remaining
  const now = p.receivedNow === undefined || p.receivedNow === null || p.receivedNow === '' ? null : parseAmount(p.receivedNow, { label: 'received now', dp: AMOUNT_DP, min: 'zero' })
  if (now && now.gt(0)) {
    if (now.gt(plan.remaining)) throw new InvalidAgencyError(`the customer owes ${plan.remaining.toFixed()} only`)
    status = (await collectAgencyTx(tx, rid, user, { orderId: order.id, amount: now, date, custodyRepId: p.custodyRepId ?? null })).status
    remaining = plan.remaining.minus(now)
  }
  return { entryId, total: plan.total.toFixed(), cost: plan.cost.toFixed(), profit: plan.profit.toFixed(), applied: plan.applied.toFixed(), refund: plan.refund.toFixed(), remaining: remaining.toFixed(), status }
}

export type CollectInput = { orderId: string; amount: Dec; date: string; custodyRepId?: string | null; note?: string | null }

/** The principal pays what is still owed after settlement: DR till or custody, CR AGENCY_RECEIVABLE. */
export async function collectAgencyTx(tx: Db, rid: string, user: WhUser, p: CollectInput): Promise<{ entryId: string; status: 'DELIVERED' | 'CLOSED' }> {
  requireManager(user)
  const order = await lockOrder(tx, rid, String(p?.orderId ?? ''))
  if (order.status !== 'DELIVERED') throw new InvalidAgencyError('only a settled order with a balance can be collected')
  const amount = positive(p.amount, 'amount')
  const date = requireDay(p.date, 'date')
  const balance = balanceOf(order)
  if (amount.gt(balance.receivable)) throw new InvalidAgencyError(`the customer owes ${balance.receivable.toFixed()} only`)
  const to = await receiving(tx, p.custodyRepId, order.currency, amount)
  const { entryId } = await postJournal(tx, rid, {
    date,
    memo: `Payment on special order #${order.number}`,
    source: { type: 'AGENCY_COLLECTION', id: randomUUID() },
    user,
    lines: [to.line, { accountCode: 'AGENCY_RECEIVABLE', side: 'CR', amount, currency: order.currency, partyId: order.principalId }],
  })
  await addRows(tx, rid, order, user, entryId, date, [{ kind: 'COLLECTION', amount, note: optionalText(p.note, 500), custodyRepId: to.repId }])
  const status = nextStatusAfterCollection(balance.receivable.minus(amount)) as 'DELIVERED' | 'CLOSED'
  if (status === 'CLOSED') await tx.whAgencyOrder.update({ where: { id: order.id }, data: { status } })
  return { entryId, status }
}

/** Cancel an open order that has no cost yet: held advances go back to the principal from the till. */
export async function cancelAgencyOrderTx(tx: Db, rid: string, user: WhUser, p: { orderId: string; date: string }): Promise<{ entryId: string | null }> {
  requireManager(user)
  const order = await lockOrder(tx, rid, String(p?.orderId ?? ''))
  if (order.status !== 'OPEN') throw new InvalidAgencyError('only an open order can be cancelled')
  const b = balanceOf(order)
  if (b.costs.gt(0)) throw new InvalidAgencyError('money was already paid for this order: settle it instead')
  let entryId: string | null = null
  if (b.advanceHeld.gt(0)) {
    const date = requireDay(p.date, 'date')
    entryId = (
      await postJournal(tx, rid, {
        date,
        memo: `Cancelled special order #${order.number}: advances paid back`,
        source: { type: 'AGENCY_CANCEL', id: order.id },
        user,
        lines: [
          { accountCode: 'CUSTOMER_ADVANCES', side: 'DR', amount: b.advanceHeld, currency: order.currency, partyId: order.principalId },
          { accountCode: cashAccount(order.currency), side: 'CR', amount: b.advanceHeld, currency: order.currency },
        ],
      })
    ).entryId
    await addRows(tx, rid, order, user, entryId, date, [{ kind: 'REFUND', amount: b.advanceHeld }])
  }
  await tx.whAgencyOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } })
  return { entryId }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------

const orderBase = {
  id: true,
  number: true,
  title: true,
  note: true,
  currency: true,
  agreedTotal: true,
  status: true,
  date: true,
  settledAt: true,
  principal: { select: { id: true, name: true, ownerName: true, phone: true, address: true } },
} as const

function shape<T extends { movements: { kind: AgencyKind; amount: { toString(): string } }[] }>(o: T) {
  const b = balanceOf(o)
  return { ...o, balance: { advanceReceived: b.advanceReceived.toFixed(), advanceHeld: b.advanceHeld.toFixed(), costs: b.costs.toFixed(), saleTotal: b.saleTotal.toFixed(), profit: b.profit.toFixed(), receivable: b.receivable.toFixed() } }
}

export async function listAgencyOrders(tx: Db, user: WhUser) {
  requireManager(user)
  const rows = await tx.whAgencyOrder.findMany({ orderBy: [{ number: 'desc' }], select: { ...orderBase, movements: { select: { kind: true, amount: true } } } })
  return rows.map(shape)
}

export async function getAgencyOrder(tx: Db, user: WhUser, id: string) {
  requireManager(user)
  const o = await tx.whAgencyOrder.findUnique({
    where: { id },
    select: { ...orderBase, movements: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], select: { id: true, kind: true, amount: true, date: true, note: true, category: true, custodyRepId: true, journalEntryId: true } } },
  })
  return o ? shape(o) : null
}

/** Every order opened in a period with all its movements, for the spreadsheet. */
export async function agencyExport(tx: Db, from: string, to: string) {
  const orders = await tx.whAgencyOrder.findMany({
    where: { date: { gte: toDbDate(from), lte: toDbDate(to) } },
    orderBy: { number: 'asc' },
    select: { ...orderBase, movements: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], select: { kind: true, amount: true, date: true, note: true, category: true } } },
  })
  return orders.map(shape)
}
