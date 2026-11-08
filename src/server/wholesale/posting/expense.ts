/* eslint-disable no-restricted-properties -- row lock of one expense: the statement binds "restaurantId" (the company's own id) */
import { randomUUID } from 'node:crypto'
import type Decimal from 'decimal.js'
import type { ScopedTx } from '@/server/data/tenant-db'
import type { LineInput } from '@/server/domain/wholesale/ledger'
import { D } from '@/server/domain/wholesale/money'
import { ForbiddenError, canWh, type WhRole } from '@/server/domain/wholesale/permissions'
import { isCurrency, round4 } from '@/server/domain/wholesale/purchase'
import { baghdadDate, isIsoDate, type Currency } from '@/server/domain/wholesale/rates'
import { ExpenseStateError, InvalidExpenseError, expenseAccount, isExpenseCategory, parseTreasuryAmount, type ExpenseCategory } from '@/server/domain/wholesale/treasury'
import { assertNotFuture } from '@/server/wholesale/clock'
import { postJournal } from '@/server/wholesale/ledger'
import { assertPeriodOpen } from '@/server/wholesale/period'
import { lockCustody, releaseRate, requireAvailableCustody } from '@/server/wholesale/posting/custody'
import { requireRates } from '@/server/wholesale/rates'

export { ExpenseStateError, InvalidExpenseError } from '@/server/domain/wholesale/treasury'

/*
 * Operating expenses (rent, salaries, fuel, transport, utilities, other): DR EXPENSE_<category>.
 *
 * - A user with expense.manage (OWNER/PARTNER) posts at once, on any open date, paid from the cash box of the expense currency.
 * - A REP records his expenses (fuel) with the partner's approval: saved PENDING, dated today, nothing posted. On approval it is posted on
 *   the approval day and paid FROM THE REP'S CUSTODY: DR EXPENSE / CR REP_CUSTODY at the custody's average rate, the IQD gap to FX_GAIN/FX_LOSS.
 *   The custody must hold it (InsufficientCustodyError; the expense stays pending).
 * Locks: the rep's custody lock, then the expense row; two approvals cannot both post (ExpenseStateError).
 */

type Db = ScopedTx
type WhUser = { id: string; role: WhRole }
type DD = InstanceType<typeof D>
type Dec = Decimal | string

const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`)
const cashAccount = (c: Currency) => `CASH_${c}`
const NOTE_MAX = 500

export type ExpenseInput = {
  category: ExpenseCategory
  amount: { amount: Dec; currency: Currency }
  date: string
  warehouseId?: string | null
  note?: string | null
}
export type PostExpenseResult = { expenseId: string; status: 'POSTED' | 'PENDING' }

function requireId(v: unknown, label: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new InvalidExpenseError(`${label} is required`)
  return v.trim()
}

async function warehouseFor(tx: Db, user: WhUser, direct: boolean, id: unknown): Promise<string | null> {
  if (id === undefined || id === null || id === '') {
    if (direct) return null
    const own = await tx.whWarehouse.findFirst({ where: { repUserId: user.id }, select: { id: true } })
    return own?.id ?? null
  }
  const w = await tx.whWarehouse.findUnique({ where: { id: requireId(id, 'warehouse') }, select: { id: true, kind: true, repUserId: true } })
  if (!w) throw new InvalidExpenseError('unknown warehouse')
  if (!direct && !(w.kind === 'REP' && w.repUserId === user.id)) throw new ForbiddenError('expense:submit')
  return w.id
}

export async function postExpenseTx(tx: Db, rid: string, user: WhUser, input: ExpenseInput): Promise<PostExpenseResult> {
  if (!input || typeof input !== 'object') throw new InvalidExpenseError('expense is required')
  if (!isExpenseCategory(input.category)) throw new InvalidExpenseError(`unknown expense category: ${String(input.category)}`)
  const m = input.amount
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new InvalidExpenseError('amount is required')
  if (!isCurrency(m.currency)) throw new InvalidExpenseError(`unknown currency: ${String(m.currency)}`)
  const currency = m.currency
  const amount = parseTreasuryAmount(m.amount, 'amount', InvalidExpenseError)
  let note: string | null = null
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') throw new InvalidExpenseError('note must be text')
    note = input.note.trim() || null
    if (note && note.length > NOTE_MAX) throw new InvalidExpenseError(`note is longer than ${NOTE_MAX} characters`)
  }
  const direct = canWh(user.role, 'expense.manage')
  let date: string
  if (direct) {
    if (!isIsoDate(input.date)) throw new InvalidExpenseError('date must be a date (YYYY-MM-DD)')
    date = input.date
    assertNotFuture(date)
  } else date = baghdadDate()
  const warehouseId = await warehouseFor(tx, user, direct, input.warehouseId)
  const category = input.category
  const expenseId = randomUUID()

  if (!direct) {
    await tx.whExpense.create({
      data: { id: expenseId, restaurantId: rid, category, amount: amount.toFixed(), currency, date: toDbDate(date), note, warehouseId, paidFrom: 'CUSTODY', custodyRepId: user.id, status: 'PENDING', userId: user.id },
    })
    return { expenseId, status: 'PENDING' }
  }

  await assertPeriodOpen(tx, rid, date)
  const rates = await requireRates(tx, date, [currency])
  const rate = currency === 'IQD' ? new D(1) : new D(rates.iqdPer[currency]!)
  const lines: LineInput[] = [
    { accountCode: expenseAccount(category), side: 'DR', amount, currency },
    { accountCode: cashAccount(currency), side: 'CR', amount, currency },
  ]
  const { entryId } = await postJournal(tx, rid, { date, memo: `Expense: ${category.toLowerCase()}${note ? ` (${note})` : ''}`, source: { type: 'EXPENSE', id: expenseId }, user, lines })
  const amountIqd = round4(amount.times(rate))
  await tx.whExpense.create({
    data: {
      id: expenseId,
      restaurantId: rid,
      category,
      amount: amount.toFixed(),
      currency,
      date: toDbDate(date),
      note,
      warehouseId,
      paidFrom: 'CASH',
      status: 'POSTED',
      rateIqd: rate.toFixed(),
      amountIqd: amountIqd.toFixed(),
      fxDiffIqd: '0',
      journalEntryId: entryId,
      decidedById: user.id,
      decidedAt: new Date(),
      userId: user.id,
    },
  })
  return { expenseId, status: 'POSTED' }
}

/** Lock order: the rep's custody (custody-paid expenses), then the expense row. Returns the pending expense. */
async function lockPendingExpense(tx: Db, rid: string, user: WhUser, expenseId: string) {
  const id = requireId(expenseId, 'expense')
  const head = await tx.whExpense.findUnique({ where: { id }, select: { userId: true, custodyRepId: true } })
  if (!head) throw new InvalidExpenseError('unknown expense')
  if (head.userId === user.id) throw new ForbiddenError('expense.manage')
  if (head.custodyRepId) await lockCustody(tx, rid, head.custodyRepId)
  await tx.$queryRaw`SELECT id FROM "WhExpense" WHERE id = ${id} AND "restaurantId" = ${rid} FOR NO KEY UPDATE`
  const e = await tx.whExpense.findUniqueOrThrow({ where: { id } })
  if (e.status !== 'PENDING') throw new ExpenseStateError(`the expense is ${e.status.toLowerCase()}, not waiting for approval`)
  return e
}

export async function approveExpenseTx(tx: Db, rid: string, user: WhUser, expenseId: string): Promise<{ entryId: string }> {
  const e = await lockPendingExpense(tx, rid, user, expenseId)
  const date = baghdadDate()
  await assertPeriodOpen(tx, rid, date)
  const amount = new D(e.amount.toString())
  const currency = e.currency
  const rates = await requireRates(tx, date, [currency])
  const rate = currency === 'IQD' ? new D(1) : new D(rates.iqdPer[currency]!)
  const amountIqd = round4(amount.times(rate))
  const lines: LineInput[] = [{ accountCode: expenseAccount(e.category), side: 'DR', amount, currency }]
  let fx: DD = new D(0)
  if (e.paidFrom === 'CUSTODY') {
    const repId = e.custodyRepId!
    const balance = await requireAvailableCustody(tx, rid, repId, currency, amount)
    const out = await releaseRate(tx, currency, balance, date)
    fx = amountIqd.minus(round4(amount.times(out)))
    lines.push({ accountCode: 'REP_CUSTODY', side: 'CR', amount, currency, partyId: repId, ...(currency === 'IQD' ? {} : { rateIqd: out }) })
    if (fx.abs().gte('0.01')) lines.push({ accountCode: fx.gt(0) ? 'FX_GAIN' : 'FX_LOSS', side: fx.gt(0) ? 'CR' : 'DR', amount: fx.abs(), currency: 'IQD' })
  } else lines.push({ accountCode: cashAccount(currency), side: 'CR', amount, currency })
  const { entryId } = await postJournal(tx, rid, { date, memo: `Expense #${e.number}: ${e.category.toLowerCase()}${e.note ? ` (${e.note})` : ''}`, source: { type: 'EXPENSE', id: e.id }, user, lines })
  await tx.whExpense.update({
    where: { id: e.id },
    data: { status: 'POSTED', date: toDbDate(date), rateIqd: rate.toFixed(), amountIqd: amountIqd.toFixed(), fxDiffIqd: fx.toFixed(), journalEntryId: entryId, decidedById: user.id, decidedAt: new Date() },
  })
  return { entryId }
}

export async function rejectExpenseTx(tx: Db, rid: string, user: WhUser, expenseId: string, reason: string): Promise<void> {
  if (typeof reason !== 'string' || !reason.trim()) throw new InvalidExpenseError('a reason is required')
  const e = await lockPendingExpense(tx, rid, user, expenseId)
  await tx.whExpense.update({ where: { id: e.id }, data: { status: 'REJECTED', statusReason: reason.trim(), decidedById: user.id, decidedAt: new Date() } })
}

const listSelect = { id: true, number: true, category: true, amount: true, currency: true, date: true, note: true, status: true, statusReason: true, requestedAt: true, userId: true, warehouse: { select: { id: true, name: true } } } as const

/** Expenses, newest first; a REP sees only his own. */
export async function listExpenses(tx: Db, user: WhUser, status?: 'PENDING') {
  const rows = await tx.whExpense.findMany({
    where: { ...(status ? { status } : {}), ...(canWh(user.role, 'expense.manage') ? {} : { userId: user.id }) },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    select: listSelect,
  })
  return rows.map((r) => ({ ...r, number: r.number.toString(), date: r.date.toISOString().slice(0, 10) }))
}
