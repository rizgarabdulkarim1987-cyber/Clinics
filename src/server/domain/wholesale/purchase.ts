import Decimal from 'decimal.js'
import { AMOUNT_DP, AMOUNT_MAX } from '@/server/domain/wholesale/ledger'
import { D, convert } from '@/server/domain/wholesale/money'
import { CURRENCIES, RATED_CURRENCIES, type Currency, type PartialRates } from '@/server/domain/wholesale/rates'

/* Pure purchase rules: input parsing, rate snapshots, and how a supplier payment settles open documents. */

type DD = InstanceType<typeof D>

export const PAYMENT_MODES = ['CASH', 'CREDIT'] as const
export type PaymentMode = (typeof PAYMENT_MODES)[number]
export const LANDED_COST_KINDS = ['SHIPPING', 'CUSTOMS', 'CLEARANCE', 'TRANSPORT', 'OTHER'] as const
export type LandedCostKind = (typeof LANDED_COST_KINDS)[number]

/** Bad purchase/landed-cost/payment input (unknown supplier, item or unit, bad number, date...). Nothing was written. */
export class InvalidPurchaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPurchaseError'
  }
}

/** The purchase is in a state that forbids this (cancelled, stock already issued, has landed costs or payments...). */
export class PurchaseStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PurchaseStateError'
  }
}

/**
 * The purchase cannot be cancelled because its stock has been touched since it was received (issued, transferred,
 * adjusted or re-costed), or it has landed costs or payments. A PurchaseStateError.
 */
export class PurchaseNotCancellableError extends PurchaseStateError {
  constructor(message: string) {
    super(message)
    this.name = 'PurchaseNotCancellableError'
  }
}

/** A supplier payment would settle more than is open. `open` is in the document currency (or the paid currency). */
export class OverpaymentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OverpaymentError'
  }
}

export const isCurrency = (v: unknown): v is Currency => typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v)
export const isPaymentMode = (v: unknown): v is PaymentMode => typeof v === 'string' && (PAYMENT_MODES as readonly string[]).includes(v)
export const isLandedCostKind = (v: unknown): v is LandedCostKind => typeof v === 'string' && (LANDED_COST_KINDS as readonly string[]).includes(v)

/**
 * An entered number: a string or Decimal, never a JS number. Never rounded: more than `dp` decimals is refused, so
 * what is stored is exactly what was entered. `min` 'positive' rejects zero.
 */
export function parseAmount(v: unknown, o: { label: string; dp: number; min: 'zero' | 'positive'; max?: Decimal }): DD {
  if (typeof v === 'number') throw new InvalidPurchaseError(`${o.label} must be a string or Decimal, not a number`)
  if (typeof v !== 'string' && !Decimal.isDecimal(v)) throw new InvalidPurchaseError(`${o.label} is required`)
  let d: DD
  try {
    d = new D(typeof v === 'string' ? v.trim() : (v as Decimal).toString())
  } catch {
    throw new InvalidPurchaseError(`${o.label} is not a number`)
  }
  if (!d.isFinite()) throw new InvalidPurchaseError(`${o.label} must be finite`)
  if (o.min === 'positive' ? !d.gt(0) : d.isNegative() && !d.isZero()) throw new InvalidPurchaseError(`${o.label} must be ${o.min === 'positive' ? 'greater than zero' : 'zero or more'}`)
  if (d.decimalPlaces() > o.dp) throw new InvalidPurchaseError(`${o.label} has more than ${o.dp} decimal places`)
  if (d.gte(o.max ?? AMOUNT_MAX)) throw new InvalidPurchaseError(`${o.label} is too large`)
  return d.isZero() ? new D(0) : d
}

export const round4 = (v: Decimal): DD => new D(v).toDecimalPlaces(AMOUNT_DP, D.ROUND_HALF_UP)

/** {USD?, IRT?} as decimal strings: the rates a document locked, for the foreign currencies it involves. */
export type RateSnapshot = Partial<Record<'USD' | 'IRT', string>>

export function snapshotOf(rates: PartialRates, currencies: Currency[]): RateSnapshot {
  const out: RateSnapshot = {}
  for (const c of RATED_CURRENCIES) if (currencies.includes(c)) out[c] = new D(rates.iqdPer[c]!).toFixed()
  return out
}

/** The locked IQD-per-unit rate of `currency` in a snapshot (IQD = 1). Throws if the snapshot lacks it. */
export function snapshotRate(snap: unknown, currency: Currency): DD {
  if (currency === 'IQD') return new D(1)
  const v = (snap as RateSnapshot | null)?.[currency]
  if (typeof v !== 'string') throw new Error(`rate snapshot has no ${currency} rate`)
  return new D(v)
}

/**
 * An open document: a supplier's credit purchase or credit landed cost, a customer's credit sale (posting/sale.ts),
 * or an opening debt of either (import/opening.ts), with what is still open in its own currency.
 */
export type OpenDoc = { kind: 'PURCHASE' | 'LANDED_COST' | 'SALE' | 'OPENING'; id: string; currency: Currency; open: Decimal }
export type Settlement = { doc: OpenDoc; settled: DD; paid: DD }

/**
 * Spread a payment of `amount` `currency` over `docs` in the given order (the caller sorts them FIFO). Each document
 * is settled in its own currency: settled = the payment converted at the payment-day `rates`, 4 dp. A document that
 * is fully settled consumes its open amount converted back to the paid currency (4 dp); the last one gets exactly
 * what is left, so the `paid` parts sum EXACTLY to `amount`. Throws OverpaymentError when anything is left after the
 * last open document (or a document would be settled beyond its open amount); InvalidPurchaseError when the payment
 * is too small to settle anything at 4 dp.
 */
export function settlePayment(amount: Decimal, currency: Currency, docs: OpenDoc[], rates: PartialRates): Settlement[] {
  let left = new D(amount)
  const out: Settlement[] = []
  for (const doc of docs) {
    if (left.isZero()) break
    const open = new D(doc.open)
    if (!open.gt(0)) continue
    const want = round4(convert({ amount: left, currency }, doc.currency, rates).amount)
    if (want.lte(open)) {
      if (!want.gt(0)) throw new InvalidPurchaseError('the payment is too small to settle anything')
      out.push({ doc, settled: want, paid: left })
      left = new D(0)
      break
    }
    const paid = round4(convert({ amount: open, currency: doc.currency }, currency, rates).amount)
    if (paid.gte(left)) {
      // rounding: the rest of the payment is worth (at 4 dp) no more than this document's open amount
      out.push({ doc, settled: open, paid: left })
      left = new D(0)
      break
    }
    if (paid.gt(0)) {
      out.push({ doc, settled: open, paid })
      left = left.minus(paid)
    }
  }
  if (left.gt(0)) {
    const open = docs.reduce<string[]>((a, x) => (new D(x.open).gt(0) ? [...a, `${new D(x.open).toFixed()} ${x.currency}`] : a), [])
    throw new OverpaymentError(`payment of ${new D(amount).toFixed()} ${currency} is more than the open balance (${open.join(' + ') || 'nothing open'})`)
  }
  return out
}
