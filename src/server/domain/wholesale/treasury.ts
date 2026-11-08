import type Decimal from 'decimal.js'
import { AMOUNT_DP, AMOUNT_MAX, ROUNDING_TOLERANCE_IQD } from '@/server/domain/wholesale/ledger'
import { D } from '@/server/domain/wholesale/money'
import { InvalidPurchaseError, isCurrency, parseAmount, round4 } from '@/server/domain/wholesale/purchase'
import { RATE_DP, type Currency, type PartialRates } from '@/server/domain/wholesale/rates'

/*
 * Pure rules for cash conversion, rep custody handover and expenses (Task 10). The DB side is in
 * src/server/posting/{conversion,custody,expense}.ts.
 */

type DD = InstanceType<typeof D>
type Dec = Decimal | string

/* ----------------------------------------------------------------- errors */

/** Bad conversion input: same currency, amount not > 0, more than 4 dp, too large, or worth nothing in the target. */
export class InvalidConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidConversionError'
  }
}

/** Bad handover input (no amounts, a duplicate currency, a received amount above the submitted one...). */
export class InvalidCustodyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCustodyError'
  }
}

/** The handover is not pending (already confirmed or rejected). */
export class CustodyStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustodyStateError'
  }
}

/** The rep's custody (less what pending handovers already reserve) is below what is asked for, in one currency. */
export class InsufficientCustodyError extends Error {
  constructor(
    public readonly currency: Currency,
    public readonly available: Decimal,
    public readonly requested: Decimal,
  ) {
    super(`not enough ${currency} in custody: available ${available.toFixed()}, requested ${requested.toFixed()}`)
    this.name = 'InsufficientCustodyError'
  }
}

/** Bad expense input (unknown category or currency, bad amount or date, a warehouse the user may not use). */
export class InvalidExpenseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidExpenseError'
  }
}

/** The expense is not pending (already posted or rejected). */
export class ExpenseStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExpenseStateError'
  }
}

/* ------------------------------------------------------------- amounts */

/** An entered amount (string or Decimal, never a number): > 0 (or >= 0 with min 'zero'), at most 4 dp, below AMOUNT_MAX. */
export function parseTreasuryAmount<E extends Error>(v: unknown, label: string, Err: new (m: string) => E, min: 'zero' | 'positive' = 'positive'): DD {
  try {
    return parseAmount(v, { label, dp: AMOUNT_DP, min })
  } catch (e) {
    if (e instanceof InvalidPurchaseError) throw new Err(e.message)
    throw e
  }
}

/**
 * A list of amounts, at most one per currency (Money[] as entered). Returns currency -> amount in CURRENCIES order.
 * `min` 'zero' accepts 0 (received amounts); 'positive' refuses it (submitted amounts).
 */
export function parseMoneyList(list: unknown, label: string, min: 'zero' | 'positive'): Map<Currency, DD> {
  if (!Array.isArray(list) || list.length === 0) throw new InvalidCustodyError(`${label}: at least one amount is required`)
  const out = new Map<Currency, DD>()
  for (const [i, m] of list.entries()) {
    const at = `${label} ${i + 1}`
    if (!m || typeof m !== 'object') throw new InvalidCustodyError(`${at}: not an amount`)
    const { amount, currency } = m as { amount: unknown; currency: unknown }
    if (!isCurrency(currency)) throw new InvalidCustodyError(`${at}: unknown currency ${String(currency)}`)
    if (out.has(currency)) throw new InvalidCustodyError(`${at}: ${currency} is given twice`)
    out.set(currency, parseTreasuryAmount(amount as Dec, at, InvalidCustodyError, min))
  }
  return out
}

/* ---------------------------------------------------------- conversion */

export type ConversionAmounts = {
  fromRateIqd: DD
  toRateIqd: DD
  /** from x fromRate / toRate, 4 dp half-up. */
  toAmount: DD
  /** IQD value of each side as the ledger stores it (amount x rate, 4 dp half-up). */
  fromIqd: DD
  toIqd: DD
  /** toIqd - fromIqd: > 0 the box received more IQD value than it gave (gain), < 0 a loss. */
  fxDiffIqd: DD
  /** The FX line the entry needs: none when |fxDiffIqd| < 0.01 IQD (the ledger's ROUNDING line takes that residue). */
  fxLine: { account: 'FX_GAIN' | 'FX_LOSS'; amountIqd: DD } | null
}

const rateOf = (rates: PartialRates, c: Currency): DD => {
  if (c === 'IQD') return new D(1)
  const r = rates.iqdPer[c]
  if (r === undefined) throw new Error(`no ${c} rate in the given rates`)
  return new D(r)
}

/**
 * Convert `amount` of `from` into `to` at the day's rates (IQD per unit). Rounded once, to the stored 4 dp, half-up:
 * the same rule as every other posted amount. Refuses a result that rounds to 0 or reaches AMOUNT_MAX.
 */
export function conversionAmounts(amount: Decimal, from: Currency, to: Currency, rates: PartialRates): ConversionAmounts {
  if (from === to) throw new InvalidConversionError('a conversion needs two different currencies')
  const fromRateIqd = rateOf(rates, from)
  const toRateIqd = rateOf(rates, to)
  const toAmount = round4(new D(amount).times(fromRateIqd).div(toRateIqd))
  if (!toAmount.gt(0)) throw new InvalidConversionError(`the amount is worth less than 0.0001 ${to}`)
  if (toAmount.gte(AMOUNT_MAX)) throw new InvalidConversionError(`the converted amount must be below ${AMOUNT_MAX.toFixed()}`)
  const fromIqd = round4(new D(amount).times(fromRateIqd))
  const toIqd = round4(toAmount.times(toRateIqd))
  const fxDiffIqd = toIqd.minus(fromIqd)
  const fxLine = fxDiffIqd.abs().lt(ROUNDING_TOLERANCE_IQD) ? null : { account: fxDiffIqd.gt(0) ? ('FX_GAIN' as const) : ('FX_LOSS' as const), amountIqd: fxDiffIqd.abs() }
  return { fromRateIqd, toRateIqd, toAmount, fromIqd, toIqd, fxDiffIqd, fxLine }
}

/* ------------------------------------------------------------- custody */

/** A rep's custody in one currency: the amount and the IQD value REP_CUSTODY carries it at (DR - CR of baseIqd). */
export type CustodyBalance = { amount: DD; iqd: DD }

/**
 * The rate custody is released at: its average IQD rate (iqd / amount), 8 dp half-up (a pinned ledger rate), so
 * moving custody to a cash box or spending it never books FX noise on the custody side. 1 for IQD. null when there
 * is no positive balance to average (the caller falls back to the day rate).
 */
export function custodyRate(currency: Currency, b: CustodyBalance): DD | null {
  if (currency === 'IQD') return new D(1)
  if (!b.amount.gt(0) || !b.iqd.gt(0)) return null
  const r = b.iqd.div(b.amount).toDecimalPlaces(RATE_DP, D.ROUND_HALF_UP)
  return r.gt(0) && r.lt(new D('1e10')) ? r : null
}

/* ------------------------------------------------------------- expenses */

/** Matches the seeded EXPENSE_* accounts (src/domain/ledger.ts CHART_OF_ACCOUNTS) and the ExpenseCategory DB enum. */
export const EXPENSE_CATEGORIES = ['RENT', 'SALARIES', 'FUEL', 'TRANSPORT', 'UTILITIES', 'OTHER'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
export const isExpenseCategory = (v: unknown): v is ExpenseCategory => typeof v === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(v)
export const expenseAccount = (c: ExpenseCategory) => `EXPENSE_${c}` as const
