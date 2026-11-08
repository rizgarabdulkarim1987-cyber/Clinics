/* eslint-disable no-restricted-properties -- advisory locks and row locks of one company: every statement binds the company's own id */
import Decimal from 'decimal.js'
import { Prisma } from '@/generated/prisma/client'
import type { ScopedTx } from '@/server/data/tenant-db'
import {
  AlreadyReversedError,
  CHART_OF_ACCOUNTS,
  CurrencyMismatchError,
  InvalidEntryError,
  ReversalError,
  UnknownAccountError,
  currenciesOf,
  mirrorLines,
  priceLines,
  validateLines,
  type LineInput,
  type PricedLine,
} from '@/server/domain/wholesale/ledger'
import { baghdadDate, isIsoDate } from '@/server/domain/wholesale/rates'
import { assertNotFuture } from '@/server/wholesale/clock'
import { assertPeriodOpen } from '@/server/wholesale/period'
import { requireRates } from '@/server/wholesale/rates'

export type { LineInput } from '@/server/domain/wholesale/ledger'

type Db = ScopedTx
type SessionUser = { id: string }

/** The opening-balances advisory lock of one company, held until the transaction ends. */
export async function lockOpening(tx: Db, rid: string, mode: 'shared' | 'exclusive'): Promise<void> {
  const key = `opening:import:${rid}`
  if (mode === 'exclusive') await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)) s`
  else await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock_shared(hashtext(${key})::bigint)) s`
}
const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`)

/**
 * Map each line's account code to its id. Unknown codes and non-postable groups throw UnknownAccountError; a line
 * whose currency differs from the account's fixed currency (cash boxes) throws CurrencyMismatchError.
 */
async function accountIds(tx: Db, lines: PricedLine[]): Promise<Map<string, string>> {
  const unique = [...new Set(lines.map((l) => l.accountCode))]
  const rows = await tx.whLedgerAccount.findMany({
    where: { code: { in: unique } },
    select: { id: true, code: true, postable: true, currency: true },
  })
  const byCode = new Map(rows.map((r) => [r.code, r]))
  for (const l of lines) {
    const r = byCode.get(l.accountCode)
    if (!r) throw new UnknownAccountError(l.accountCode)
    if (!r.postable) throw new UnknownAccountError(l.accountCode, 'group account cannot be posted to')
    if (r.currency && r.currency !== l.currency) throw new CurrencyMismatchError(l.accountCode, r.currency, l.currency)
  }
  return new Map(rows.map((r) => [r.code, r.id]))
}

type EntryHeader = { date: string; memo: string; sourceType: string; sourceId: string; userId: string; reversesId?: string }

/** The only write path for ledger rows. Stored values are decimal strings (no float conversions). */
async function insertEntry(tx: Db, rid: string, h: EntryHeader, lines: PricedLine[]): Promise<{ id: string; number: bigint }> {
  const ids = await accountIds(tx, lines)
  return tx.whJournalEntry.create({
    data: {
      restaurantId: rid,
      date: toDbDate(h.date),
      memo: h.memo,
      sourceType: h.sourceType,
      sourceId: h.sourceId,
      userId: h.userId,
      reversesId: h.reversesId,
      lines: {
        create: lines.map((l, i) => ({
          restaurantId: rid,
          lineNo: i + 1,
          accountId: ids.get(l.accountCode)!,
          side: l.side,
          amount: l.amount.toFixed(),
          currency: l.currency,
          rateIqd: l.rateIqd.toFixed(),
          baseIqd: l.baseIqd.toFixed(),
          partyId: l.partyId ?? null,
        })),
      },
    },
    select: { id: true, number: true },
  })
}

export type PostJournalInput = {
  date: string
  memo: string
  source: { type: string; id: string }
  user: SessionUser
  lines: LineInput[]
}

/**
 * Post one balanced journal entry inside the caller's transaction.
 * Order: validate -> period open (shared month lock) -> rates for only the currencies used (an all-IQD entry needs no
 * rate row) -> convert and balance (see priceLines: sub-0.01 IQD diff to ROUNDING, else UnbalancedEntryError) ->
 * resolve accounts -> insert -> audit. Every failure throws before anything is written. No shared mutable state;
 * the entry number comes from a Postgres sequence, so concurrent posts are safe.
 */
export async function postJournal(tx: Db, rid: string, p: PostJournalInput): Promise<{ entryId: string }> {
  if (!isIsoDate(p.date)) throw new InvalidEntryError(`invalid date: ${String(p.date)}`)
  // never dated in the future (FutureDateError; one day of slack, see server/clock.ts)
  assertNotFuture(p.date)
  if (typeof p.memo !== 'string' || !p.memo.trim()) throw new InvalidEntryError('memo is required')
  if (!p.source || !p.source.type?.trim() || !p.source.id?.trim()) throw new InvalidEntryError('source type and id are required')
  validateLines(p.lines)
  await assertPeriodOpen(tx, rid, p.date)
  // Opening balances (import/opening.ts) are the start of the books: nothing may be dated before them. withTx already
  // holds the opening lock (shared) from the start of the transaction; taking it here again is a no-op then, and
  // covers a transaction opened some other way.
  await lockOpening(tx, rid, 'shared')
  const opening = await tx.whOpeningImport.findFirst({ orderBy: { date: 'asc' }, select: { date: true } })
  if (opening && p.date < opening.date.toISOString().slice(0, 10))
    throw new InvalidEntryError(`entries cannot be dated before the opening balances (${opening.date.toISOString().slice(0, 10)})`)
  const rates = await requireRates(tx, p.date, currenciesOf(p.lines))
  const priced = priceLines(p.lines, rates)
  const entry = await insertEntry(
    tx,
    rid,
    { date: p.date, memo: p.memo, sourceType: p.source.type, sourceId: p.source.id, userId: p.user.id },
    priced,
  )
  return { entryId: entry.id }
}

/**
 * Reverse a posted entry with a new entry dated today (Asia/Baghdad): same accounts, amounts, currencies, rates and
 * baseIqd as the original, sides swapped, so it balances exactly. The original row is never touched; it counts as
 * reversed because a reversal row points at it (`reversesId`, unique in the DB). A reversal cannot be reversed.
 * NO permission check here (nor in postJournal): any UI/route that reverses must call requireCan itself. Today's
 * month must be open.
 */
export async function reverseJournal(tx: Db, rid: string, entryId: string, user: SessionUser, reason: string): Promise<{ entryId: string }> {
  if (typeof reason !== 'string' || !reason.trim()) throw new ReversalError('a reason is required to reverse an entry')
  // Row lock (not an UPDATE, so the append-only trigger does not fire): serialises concurrent reversals of one entry.
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "WhJournalEntry" WHERE id = ${entryId} AND "restaurantId" = ${rid} FOR UPDATE`
  if (!locked.length) throw new ReversalError(`journal entry ${entryId} not found`)
  const orig = await tx.whJournalEntry.findUniqueOrThrow({
    where: { id: entryId },
    include: { reversedBy: { select: { id: true } }, lines: { include: { account: { select: { code: true } } }, orderBy: { lineNo: 'asc' } } },
  })
  if (orig.reversesId) throw new ReversalError(`journal entry ${entryId} is a reversal and cannot be reversed`)
  if (orig.reversedBy) throw new AlreadyReversedError(entryId)

  const date = baghdadDate()
  await assertPeriodOpen(tx, rid, date)
  const lines = mirrorLines<PricedLine>(
    orig.lines.map((l) => ({
      accountCode: l.account.code,
      side: l.side,
      amount: new Decimal(l.amount.toString()),
      currency: l.currency,
      rateIqd: new Decimal(l.rateIqd.toString()),
      baseIqd: new Decimal(l.baseIqd.toString()),
      ...(l.partyId ? { partyId: l.partyId } : {}),
    })),
  )
  let entry: { id: string; number: bigint }
  try {
    entry = await insertEntry(
      tx,
      rid,
      {
        date,
        memo: `Reversal of #${orig.number}: ${reason.trim()}`,
        sourceType: orig.sourceType,
        sourceId: orig.sourceId,
        userId: user.id,
        reversesId: orig.id,
      },
      lines,
    )
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AlreadyReversedError(entryId)
    throw e
  }
  return { entryId: entry.id }
}

/** Idempotent upsert of the chart of accounts (parents first). Names/tree/currency are refreshed; type on create only. */
export async function seedChartOfAccounts(db: Db, rid: string): Promise<void> {
  const ids = new Map<string, string>()
  for (const a of CHART_OF_ACCOUNTS) {
    const parentId = a.parentCode ? ids.get(a.parentCode) : undefined
    if (a.parentCode && !parentId) throw new Error(`parent ${a.parentCode} must be seeded before ${a.code}`)
    const row = await db.whLedgerAccount.upsert({
      where: { restaurantId_code: { restaurantId: rid, code: a.code } },
      create: {
        restaurantId: rid,
        code: a.code,
        type: a.type,
        normalSide: a.normalSide,
        name: a.name,
        postable: a.postable ?? true,
        currency: a.currency ?? null,
        parentId,
      },
      update: { name: a.name, postable: a.postable ?? true, currency: a.currency ?? null, parentId: parentId ?? null },
      select: { id: true },
    })
    ids.set(a.code, row.id)
  }
}
