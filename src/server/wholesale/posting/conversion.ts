import { randomUUID } from 'node:crypto'
import type Decimal from 'decimal.js'
import type { ScopedTx } from '@/server/data/tenant-db'
import type { LineInput } from '@/server/domain/wholesale/ledger'
import type { WhRole } from '@/server/domain/wholesale/permissions'
import { isCurrency } from '@/server/domain/wholesale/purchase'
import { isIsoDate, type Currency } from '@/server/domain/wholesale/rates'
import { InvalidConversionError, conversionAmounts, parseTreasuryAmount } from '@/server/domain/wholesale/treasury'
import { assertNotFuture } from '@/server/wholesale/clock'
import { postJournal } from '@/server/wholesale/ledger'
import { assertPeriodOpen } from '@/server/wholesale/period'
import { requireRates } from '@/server/wholesale/rates'

export { InvalidConversionError } from '@/server/domain/wholesale/treasury'

/*
 * Cash conversion between the currency cash boxes (treasury.manage: OWNER/PARTNER; a REP may not).
 *
 * Amounts: toAmount = from x rate(from) / rate(to), rounded once to 4 dp, half-up. The entry is DR CASH_<to> / CR CASH_<from>,
 * each line valued at the day rate. The two IQD values differ only by that rounding: |diff| >= 0.01 IQD goes to FX_GAIN or FX_LOSS;
 * a smaller residue is left to the ledger (ROUNDING). The day's manual rate must exist for both currencies (no fallback to another day).
 * Cash boxes may go negative: a conversion is entered after the money has really changed hands.
 */

type Db = ScopedTx
type WhUser = { id: string; role: WhRole }
type Dec = Decimal | string

const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`)
const cashAccount = (c: Currency) => `CASH_${c}`

export type ConvertInput = { from: { amount: Dec; currency: Currency }; toCurrency: Currency; date: string }
export type ConversionResult = { conversionId: string; entryId: string; toAmount: Decimal; fxDiffIqd: Decimal }

export async function convertCashTx(tx: Db, rid: string, user: WhUser, input: ConvertInput): Promise<ConversionResult> {
  if (!input || typeof input !== 'object' || !input.from || typeof input.from !== 'object') throw new InvalidConversionError('the amount to convert is required')
  const from = input.from.currency
  const to = input.toCurrency
  if (!isCurrency(from)) throw new InvalidConversionError(`unknown currency: ${String(from)}`)
  if (!isCurrency(to)) throw new InvalidConversionError(`unknown currency: ${String(to)}`)
  if (from === to) throw new InvalidConversionError('a conversion needs two different currencies')
  const amount = parseTreasuryAmount(input.from.amount, 'amount', InvalidConversionError)
  if (!isIsoDate(input.date)) throw new InvalidConversionError('date must be a date (YYYY-MM-DD)')
  const date = input.date
  assertNotFuture(date)

  await assertPeriodOpen(tx, rid, date)
  const rates = await requireRates(tx, date, [from, to])
  const a = conversionAmounts(amount, from, to, rates)

  const lines: LineInput[] = [
    { accountCode: cashAccount(to), side: 'DR', amount: a.toAmount, currency: to },
    { accountCode: cashAccount(from), side: 'CR', amount, currency: from },
  ]
  if (a.fxLine) lines.push({ accountCode: a.fxLine.account, side: a.fxLine.account === 'FX_GAIN' ? 'CR' : 'DR', amount: a.fxLine.amountIqd, currency: 'IQD' })

  const conversionId = randomUUID()
  const { entryId } = await postJournal(tx, rid, {
    date,
    memo: `Currency conversion ${amount.toFixed()} ${from} -> ${a.toAmount.toFixed()} ${to}`,
    source: { type: 'CURRENCY_CONVERSION', id: conversionId },
    user,
    lines,
  })
  await tx.whCurrencyConversion.create({
    data: {
      id: conversionId,
      restaurantId: rid,
      date: toDbDate(date),
      fromCurrency: from,
      fromAmount: amount.toFixed(),
      fromRateIqd: a.fromRateIqd.toFixed(),
      toCurrency: to,
      toAmount: a.toAmount.toFixed(),
      toRateIqd: a.toRateIqd.toFixed(),
      fxDiffIqd: a.fxDiffIqd.toFixed(),
      journalEntryId: entryId,
      userId: user.id,
    },
  })
  return { conversionId, entryId, toAmount: a.toAmount, fxDiffIqd: a.fxDiffIqd }
}

/** Latest conversions first (treasury.manage). */
export async function listConversions(tx: Db) {
  const rows = await tx.whCurrencyConversion.findMany({
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    select: { id: true, number: true, date: true, fromCurrency: true, fromAmount: true, toCurrency: true, toAmount: true, fxDiffIqd: true },
  })
  return rows.map((r) => ({ ...r, number: r.number.toString(), date: r.date.toISOString().slice(0, 10) }))
}
