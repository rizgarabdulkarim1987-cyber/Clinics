/* eslint-disable no-restricted-properties -- advisory locks of one company: the key carries the company's id */
type SessionUser = { id: string }
import type { ScopedTx } from '@/server/data/tenant-db'
import { PeriodClosedError, PeriodStateError } from '@/server/domain/wholesale/ledger'
import { isIsoDate } from '@/server/domain/wholesale/rates'

export { PeriodClosedError, PeriodStateError } from '@/server/domain/wholesale/ledger'

const isMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)

/**
 * Transaction-scoped advisory lock on one month. Posting takes it shared, close/reopen exclusive, so a post can
 * never commit into a month that a concurrent close has just closed (the close waits for in-flight posts, and
 * posts started after the close wait for it and then see CLOSE).
 */
async function lockMonth(tx: ScopedTx, rid: string, month: string, mode: 'shared' | 'exclusive'): Promise<void> {
  const key = `period:${rid}:${month}`
  if (mode === 'shared') await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock_shared(hashtext(${key})::bigint)) s`
  else await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)) s`
}

/** Closed when the month's latest PeriodEvent (highest id) is CLOSE. No events = open. */
export async function isPeriodClosed(tx: ScopedTx, month: string): Promise<boolean> {
  if (!isMonth(month)) throw new PeriodStateError(`invalid month: ${String(month)}`)
  const last = await tx.whPeriodEvent.findFirst({ where: { month }, orderBy: { id: 'desc' }, select: { kind: true } })
  return last?.kind === 'CLOSE'
}

/** Throws PeriodClosedError when the month of `date` ('YYYY-MM-DD') is currently closed. Holds a shared month lock. */
export async function assertPeriodOpen(tx: ScopedTx, rid: string, date: string): Promise<void> {
  if (!isIsoDate(date)) throw new PeriodStateError(`invalid date: ${String(date)}`)
  const month = date.slice(0, 7)
  await lockMonth(tx, rid, month, 'shared')
  if (await isPeriodClosed(tx, month)) throw new PeriodClosedError(month, date)
}

async function changePeriod(tx: ScopedTx, rid: string, user: SessionUser, month: string, kind: 'CLOSE' | 'REOPEN') {
  if (!isMonth(month)) throw new PeriodStateError(`invalid month: ${String(month)}`)
  await lockMonth(tx, rid, month, 'exclusive')
  const closed = await isPeriodClosed(tx, month)
  if (kind === 'CLOSE' && closed) throw new PeriodStateError(`period ${month} is already closed`)
  if (kind === 'REOPEN' && !closed) throw new PeriodStateError(`period ${month} is not closed`)
  await tx.whPeriodEvent.create({ data: { restaurantId: rid, month, kind, userId: user.id } })
}

/** Close a month ('YYYY-MM'). Needs `period:close`; appends a CLOSE event and audits. */
export function closePeriod(tx: ScopedTx, rid: string, user: SessionUser, month: string): Promise<void> {
  return changePeriod(tx, rid, user, month, 'CLOSE')
}

/** Reopen a closed month. Needs `period:close`; appends a REOPEN event (history is never edited) and audits. */
export function reopenPeriod(tx: ScopedTx, rid: string, user: SessionUser, month: string): Promise<void> {
  return changePeriod(tx, rid, user, month, 'REOPEN')
}

export type PeriodRow = {
  month: string
  closed: boolean
  /** Journal entries dated in the month. */
  entries: number
  /** The month's latest close/reopen, if any. */
  last: { kind: 'CLOSE' | 'REOPEN'; userId: string; at: Date } | null
}

/** Months a month-close screen lists, newest first: every month with entries or close/reopen events, plus the last 12. */
export async function listPeriods(db: ScopedTx, rid: string, today: string): Promise<PeriodRow[]> {
  if (!isIsoDate(today)) throw new PeriodStateError(`invalid date: ${String(today)}`)
  const counts = await db.$queryRaw<{ month: string; n: bigint }[]>`
    SELECT to_char("date", 'YYYY-MM') AS month, count(*) AS n FROM "WhJournalEntry" WHERE "restaurantId" = ${rid} GROUP BY 1`
  const events = await db.whPeriodEvent.findMany({ orderBy: { id: 'asc' }, select: { month: true, kind: true, createdAt: true, userId: true } })
  const months = new Set<string>([...counts.map((c) => c.month), ...events.map((e) => e.month)])
  const [y, m] = today.split('-').map(Number)
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    months.add(d.toISOString().slice(0, 7))
  }
  const lastOf = new Map<string, (typeof events)[number]>()
  for (const e of events) lastOf.set(e.month, e)
  return [...months]
    .sort()
    .reverse()
    .map((month) => {
      const last = lastOf.get(month)
      return {
        month,
        closed: last?.kind === 'CLOSE',
        entries: Number(counts.find((c) => c.month === month)?.n ?? 0),
        last: last ? { kind: last.kind, userId: last.userId, at: last.createdAt } : null,
      }
    })
}
