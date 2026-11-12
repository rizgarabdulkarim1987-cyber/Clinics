/* eslint-disable no-restricted-properties -- row locks and sums of one company: every statement binds "restaurantId" (the company's own id) */
import { randomUUID } from 'node:crypto'
import type Decimal from 'decimal.js'
import type { Prisma } from '@/generated/prisma/client'
import type { ScopedTx } from '@/server/data/tenant-db'
import type { LineInput } from '@/server/domain/wholesale/ledger'
import { D, type Money } from '@/server/domain/wholesale/money'
import { ForbiddenError, canWh } from '@/server/domain/wholesale/permissions'
import type { WhRole } from '@/server/domain/wholesale/permissions'
import { CURRENCIES, baghdadDate, type Currency } from '@/server/domain/wholesale/rates'
import { CustodyStateError, InsufficientCustodyError, InvalidCustodyError, custodyRate, parseMoneyList, type CustodyBalance } from '@/server/domain/wholesale/treasury'
import { postJournal } from '@/server/wholesale/ledger'
import { assertPeriodOpen } from '@/server/wholesale/period'
import { requireRates } from '@/server/wholesale/rates'

export { CustodyStateError, InsufficientCustodyError, InvalidCustodyError } from '@/server/domain/wholesale/treasury'

/*
 * Rep custody and its handover to the office.
 *
 * Custody = the rep's REP_CUSTODY balance, per currency, over the journal lines whose partyId is the rep's user id:
 * a REP's cash sale and the customer payments a REP receives debit it (posting/sale.ts); a confirmed handover and an
 * approved rep expense (posting/expense.ts) credit it. The ledger is the only source: nothing is cached.
 *
 * submitHandover (a REP, payment:receive): a PENDING handover with one line per currency, nothing posted. What pending
 * handovers submit is RESERVED: a rep can only submit (and spend on approved expenses) what is in custody and not
 * already reserved (InsufficientCustodyError).
 *
 * confirmHandover (custody:confirm: OWNER/PARTNER, never the rep themselves), dated today (Asia/Baghdad), month open.
 * `received` must name exactly the submitted currencies (0 allowed) and never more than submitted: a surplus is
 * refused (InvalidCustodyError), the rep hands extra money over with a new handover, so every amount the office books
 * is one the rep declared. Posts DR CASH_<currency> / CR REP_CUSTODY (party = the rep) for what was RECEIVED. A
 * shortfall (received < submitted) is CONFIRMED_SHORT: the shortage is recorded on the line and simply stays in
 * REP_CUSTODY, still owed by the rep (settled later by another handover). Nothing received at all posts no entry.
 *
 * Rates: both lines of a foreign currency are pinned at the custody's AVERAGE IQD rate (REP_CUSTODY baseIqd / amount
 * for that rep and currency, 8 dp), so the handover is a pure transfer between two asset accounts at the value the
 * custody already carries: no FX line, no rate row needed on the confirmation day, and the custody's IQD value goes to
 * (about) zero with its amount. A sub-fils IQD residue can stay in custody when the average does not divide exactly
 * (8 dp rate). If there is no positive balance to average (cannot happen through these functions), the day rate is
 * used. Custody's FX result is booked when it is spent (an expense, at the expense day's rate), not when it moves.
 *
 * Locks: a transaction-scoped advisory lock per rep (`custody:<repId>`) serialises everything that reserves or
 * releases custody (submit, confirm, reject, expense approval), then the handover row FOR NO KEY UPDATE; so two
 * confirmations of one handover cannot both pass (the second sees it decided: CustodyStateError).
 */

type Db = ScopedTx
type WhUser = { id: string; role: WhRole }
type DD = InstanceType<typeof D>
type Dec = Decimal | string

const dec = (v: { toString(): string }): DD => new D(v.toString())
const cashAccount = (c: Currency) => `CASH_${c}`

function requireId(v: unknown, label: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new InvalidCustodyError(`${label} is required`)
  return v.trim()
}

/** Serialise every custody change of one rep (submit, confirm, reject, a custody-paid expense approval). */
export async function lockCustody(tx: Db, rid: string, repId: string): Promise<void> {
  const key = `custody:${rid}:${repId}`
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)) s`
}

/** The rep's REP_CUSTODY balance per currency (amount and IQD value), straight from the journal lines. */
export async function custodyBalances(db: Db, rid: string, repId: string): Promise<Map<Currency, CustodyBalance>> {
  const rows = await db.$queryRaw<{ currency: Currency; amount: Prisma.Decimal; iqd: Prisma.Decimal }[]>`
    SELECT l."currency"::text AS currency,
           SUM(CASE WHEN l."side" = 'DR' THEN l."amount" ELSE -l."amount" END) AS amount,
           SUM(CASE WHEN l."side" = 'DR' THEN l."baseIqd" ELSE -l."baseIqd" END) AS iqd
      FROM "WhJournalLine" l JOIN "WhLedgerAccount" a ON a."id" = l."accountId"
     WHERE a."code" = 'REP_CUSTODY' AND l."partyId" = ${repId} AND l."restaurantId" = ${rid} AND a."restaurantId" = ${rid}
     GROUP BY l."currency"`
  return new Map(rows.map((r) => [r.currency, { amount: dec(r.amount), iqd: dec(r.iqd) }]))
}

/** What the rep's PENDING handovers submit, per currency (optionally leaving one handover out). */
async function reservedCustody(db: Db, rid: string, repId: string, exceptHandoverId?: string): Promise<Map<Currency, DD>> {
  const lines = await db.whCustodyHandoverLine.findMany({
    where: { handover: { repId, status: 'PENDING', ...(exceptHandoverId ? { id: { not: exceptHandoverId } } : {}) } },
    select: { currency: true, submitted: true },
  })
  const out = new Map<Currency, DD>()
  for (const l of lines) out.set(l.currency, (out.get(l.currency) ?? new D(0)).plus(dec(l.submitted)))
  return out
}

/** Custody per currency: balance, reserved by pending handovers, and what is still available (balance - reserved). */
async function custodyState(db: Db, rid: string, repId: string, exceptHandoverId?: string) {
  const [balances, reserved] = await Promise.all([custodyBalances(db, rid, repId), reservedCustody(db, rid, repId, exceptHandoverId)])
  const zero = { amount: new D(0), iqd: new D(0) }
  return {
    balances,
    balanceOf: (c: Currency): CustodyBalance => balances.get(c) ?? zero,
    availableOf: (c: Currency): DD => (balances.get(c)?.amount ?? new D(0)).minus(reserved.get(c) ?? new D(0)),
    reserved,
  }
}

/** Refuses `amount` of `currency` above what the rep has available (custody less pending handovers). Caller holds lockCustody. */
export async function requireAvailableCustody(db: Db, rid: string, repId: string, currency: Currency, amount: DD, exceptHandoverId?: string): Promise<CustodyBalance> {
  const s = await custodyState(db, rid, repId, exceptHandoverId)
  const available = s.availableOf(currency)
  if (amount.gt(available)) throw new InsufficientCustodyError(currency, available.lt(0) ? new D(0) : available, amount)
  return s.balanceOf(currency)
}

/** The pinned rate custody of `currency` is released at (its average), or the day rate when there is nothing to average. */
export async function releaseRate(tx: Db, currency: Currency, balance: CustodyBalance, date: string): Promise<DD> {
  const r = custodyRate(currency, balance)
  if (r) return r
  const rates = await requireRates(tx, date, [currency])
  return new D(rates.iqdPer[currency]!)
}

/* ------------------------------------------------------------------ submit */

export type HandoverInput = { amounts: { amount: Dec; currency: Currency }[] }

export async function submitHandoverTx(tx: Db, rid: string, repUser: WhUser, input: HandoverInput): Promise<{ handoverId: string }> {
  if (repUser.role !== 'REP') throw new InvalidCustodyError('only a rep holds custody to hand over')
  if (!input || typeof input !== 'object') throw new InvalidCustodyError('amounts are required')
  const amounts = parseMoneyList(input.amounts, 'amount', 'positive')
  await lockCustody(tx, rid, repUser.id)
  const s = await custodyState(tx, rid, repUser.id)
  for (const [c, a] of amounts) {
    const available = s.availableOf(c)
    if (a.gt(available)) throw new InsufficientCustodyError(c, available.lt(0) ? new D(0) : available, a)
  }
  const row = await tx.whCustodyHandover.create({
    data: { restaurantId: rid, repId: repUser.id, lines: { create: [...amounts].map(([currency, a]) => ({ restaurantId: rid, currency, submitted: a.toFixed() })) } },
    select: { id: true, number: true },
  })
  return { handoverId: row.id }
}

/* ----------------------------------------------------------------- confirm */

/** The handover's rep (unknown -> InvalidCustodyError; the rep themselves deciding -> ForbiddenError). */
async function handoverRep(tx: Db, user: WhUser, handoverId: string): Promise<string> {
  const head = await tx.whCustodyHandover.findUnique({ where: { id: handoverId }, select: { repId: true } })
  if (!head) throw new InvalidCustodyError('unknown handover')
  if (head.repId === user.id) throw new ForbiddenError('custody:confirm')
  return head.repId
}

/** Lock order: the rep's custody lock, then the handover row. Returns the pending handover with its lines. */
async function lockPendingHandover(tx: Db, rid: string, repId: string, handoverId: string) {
  await lockCustody(tx, rid, repId)
  await tx.$queryRaw`SELECT id FROM "WhCustodyHandover" WHERE id = ${handoverId} AND "restaurantId" = ${rid} FOR NO KEY UPDATE`
  const h = await tx.whCustodyHandover.findUniqueOrThrow({ where: { id: handoverId }, include: { lines: true } })
  if (h.status !== 'PENDING') throw new CustodyStateError(`the handover is ${h.status.toLowerCase()}, not pending`)
  return h
}

export type ConfirmHandoverResult = { status: 'CONFIRMED' | 'CONFIRMED_SHORT'; entryId: string | null; shortages: Money[] }

export async function confirmHandoverTx(tx: Db, rid: string, user: WhUser, handoverId: string, received: { amount: Dec; currency: Currency }[]): Promise<ConfirmHandoverResult> {
  const id = requireId(handoverId, 'handover')
  const repId = await handoverRep(tx, user, id)
  const got = parseMoneyList(received, 'received', 'zero')
  const h = await lockPendingHandover(tx, rid, repId, id)
  for (const c of got.keys()) if (!h.lines.some((l) => l.currency === c)) throw new InvalidCustodyError(`${c} was not handed over`)
  const lines = [...h.lines].sort((a, b) => CURRENCIES.indexOf(a.currency) - CURRENCIES.indexOf(b.currency))
  const settled = lines.map((l) => {
    const r = got.get(l.currency)
    if (r === undefined) throw new InvalidCustodyError(`say how much ${l.currency} was received (0 if nothing)`)
    const submitted = dec(l.submitted)
    if (r.gt(submitted)) throw new InvalidCustodyError(`more ${l.currency} received than handed over: submit a new handover for the extra`)
    return { id: l.id, currency: l.currency, submitted, received: r, shortage: submitted.minus(r) }
  })

  const date = baghdadDate()
  await assertPeriodOpen(tx, rid, date)
  const journal: LineInput[] = []
  const rates = new Map<Currency, DD>()
  for (const l of settled) {
    if (!l.received.gt(0)) continue
    // the custody is still there (it is reserved by this very handover): never release more than the balance
    const balance = await requireAvailableCustody(tx, rid, repId, l.currency, l.received, id)
    const rate = await releaseRate(tx, l.currency, balance, date)
    rates.set(l.currency, rate)
    const pin = l.currency === 'IQD' ? {} : { rateIqd: rate }
    journal.push({ accountCode: cashAccount(l.currency), side: 'DR', amount: l.received, currency: l.currency, ...pin })
    journal.push({ accountCode: 'REP_CUSTODY', side: 'CR', amount: l.received, currency: l.currency, partyId: repId, ...pin })
  }
  const entryId = journal.length ? (await postJournal(tx, rid, { date, memo: `Custody handover #${h.number}`, source: { type: 'CUSTODY_HANDOVER', id }, user, lines: journal })).entryId : null

  // lines first: the DB only settles lines of a pending handover, and checks them when the status changes
  for (const l of settled)
    await tx.whCustodyHandoverLine.update({
      where: { id: l.id },
      data: { received: l.received.toFixed(), shortage: l.shortage.toFixed(), rateIqd: rates.get(l.currency)?.toFixed() ?? null },
    })
  const shortages = settled.filter((l) => l.shortage.gt(0)).map((l) => ({ amount: l.shortage, currency: l.currency }))
  const status = shortages.length ? 'CONFIRMED_SHORT' : 'CONFIRMED'
  await tx.whCustodyHandover.update({
    where: { id },
    data: { status, date: new Date(`${date}T00:00:00Z`), decidedById: user.id, decidedAt: new Date(), journalEntryId: entryId },
  })
  return { status, entryId, shortages }
}

/** Reject a pending handover (custody:confirm; a reason is required): nothing posted, its reservation is freed. */
export async function rejectHandoverTx(tx: Db, rid: string, user: WhUser, handoverId: string, reason: string): Promise<void> {
  {
    if (typeof reason !== 'string' || !reason.trim()) throw new InvalidCustodyError('a reason is required')
    const id = requireId(handoverId, 'handover')
    const repId = await handoverRep(tx, user, id)
    await lockPendingHandover(tx, rid, repId, id)
    await tx.whCustodyHandover.update({ where: { id }, data: { status: 'REJECTED', statusReason: reason.trim(), decidedById: user.id, decidedAt: new Date() } })
  }
}

/* ----------------------------------------------------------------- reading */

export type CustodyRow = { currency: Currency; balance: Decimal; reserved: Decimal; available: Decimal }

/**
 * A rep's custody per currency (only currencies with a balance or a reservation). A REP reads only their own
 * (ForbiddenError otherwise); OWNER/PARTNER (custody:confirm) any rep's. Amounts only, no IQD value.
 */
export async function getCustody(tx: Db, rid: string, user: WhUser, repId: string): Promise<CustodyRow[]> {
  if (repId !== user.id && !canWh(user.role, 'custody.confirm')) throw new ForbiddenError('custody.confirm')
  const s = await custodyState(tx, rid, repId)
  return CURRENCIES.filter((c) => s.balances.has(c) || s.reserved.has(c))
    .map((c) => ({ currency: c, balance: s.balanceOf(c).amount, reserved: s.reserved.get(c) ?? new D(0), available: s.availableOf(c) }))
    .filter((r) => !(r.balance.isZero() && r.reserved.isZero()))
}

/** Pending handovers, oldest first (custody:confirm). */
export async function listPendingHandovers(tx: Db) {
  const rows = await tx.whCustodyHandover.findMany({
    where: { status: 'PENDING' },
    orderBy: { submittedAt: 'asc' },
    select: { id: true, number: true, submittedAt: true, lines: { select: { currency: true, submitted: true } } },
  })
  return rows.map((r) => ({ ...r, number: r.number.toString() }))
}

/* ------------------------------------------------- direct receipt from a rep */

export type ReceiveFromRepInput = { repId: string; amounts: { amount: Dec; currency: Currency }[]; date?: string }

/**
 * custody:confirm (OWNER/PARTNER, never the rep himself): the office takes cash from a rep without the rep submitting a
 * handover first (a rep who does not use the system). Same entry and rates as a confirmed handover: DR CASH_<currency> /
 * CR REP_CUSTODY (party = the rep), pinned at the custody's average rate. Never more than the rep has available (his
 * custody less what his pending handovers already reserve): InsufficientCustodyError.
 */
export async function receiveFromRepTx(tx: Db, rid: string, user: WhUser, input: ReceiveFromRepInput): Promise<{ entryId: string }> {
  if (!canWh(user.role, 'custody.confirm')) throw new ForbiddenError('custody.confirm')
  const repId = requireId(input?.repId, 'rep')
  if (repId === user.id) throw new InvalidCustodyError('a rep cannot confirm his own custody')
  const rep = await tx.whStaff.findFirst({ where: { userId: repId, role: 'REP' }, select: { userId: true } })
  if (!rep) throw new InvalidCustodyError('unknown rep')
  const amounts = parseMoneyList(input.amounts, 'amount', 'positive')
  const date = input.date ? (/^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : (() => { throw new InvalidCustodyError('date must be YYYY-MM-DD') })()) : baghdadDate()
  await assertPeriodOpen(tx, rid, date)
  await lockCustody(tx, rid, repId)
  const journal: LineInput[] = []
  for (const [currency, amount] of amounts) {
    const balance = await requireAvailableCustody(tx, rid, repId, currency, amount)
    const rate = await releaseRate(tx, currency, balance, date)
    const pin = currency === 'IQD' ? {} : { rateIqd: rate }
    journal.push({ accountCode: cashAccount(currency), side: 'DR', amount, currency, ...pin })
    journal.push({ accountCode: 'REP_CUSTODY', side: 'CR', amount, currency, partyId: repId, ...pin })
  }
  const { entryId } = await postJournal(tx, rid, { date, memo: 'Cash received from a rep', source: { type: 'CUSTODY_DIRECT', id: randomUUID() }, user, lines: journal })
  return { entryId }
}

export type RepAccount = {
  repId: string
  name: string
  custody: CustodyRow[]
  moves: { date: string; number: string; memo: string; sourceType: string; sourceId: string; currency: Currency; amount: Decimal; side: 'DR' | 'CR' }[]
}

/** Every active rep with his custody and his last movements (custody:confirm): what he collected, handed in and spent. */
export async function listRepAccounts(tx: Db, rid: string, user: WhUser, moveLimit = 40, onlyRepId?: string): Promise<RepAccount[]> {
  if (!canWh(user.role, 'custody.confirm')) throw new ForbiddenError('custody.confirm')
  const reps = await tx.whStaff.findMany({ where: { role: 'REP', deactivatedAt: null, ...(onlyRepId ? { userId: onlyRepId } : {}) }, select: { userId: true, user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } })
  const out: RepAccount[] = []
  for (const r of reps) {
    const custody = await getCustody(tx, rid, user, r.userId)
    const lines = await tx.whJournalLine.findMany({
      where: { partyId: r.userId, account: { code: 'REP_CUSTODY' } },
      orderBy: [{ entry: { date: 'desc' } }, { entry: { number: 'desc' } }],
      take: moveLimit,
      select: { side: true, amount: true, currency: true, entry: { select: { date: true, number: true, memo: true, sourceType: true, sourceId: true } } },
    })
    out.push({
      repId: r.userId,
      name: r.user.name,
      custody,
      moves: lines.map((l) => ({ date: l.entry.date.toISOString().slice(0, 10), number: l.entry.number.toString(), memo: l.entry.memo, sourceType: l.entry.sourceType, sourceId: l.entry.sourceId, currency: l.currency as Currency, amount: dec(l.amount), side: l.side as 'DR' | 'CR' })),
    })
  }
  return out
}
