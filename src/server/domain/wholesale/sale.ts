import Decimal from 'decimal.js'
import { AMOUNT_DP, AMOUNT_MAX } from '@/server/domain/wholesale/ledger'
import { D } from '@/server/domain/wholesale/money'
import { priceInCurrency, priceLine } from '@/server/domain/wholesale/pricing'
import { InvalidPurchaseError, parseAmount, round4 } from '@/server/domain/wholesale/purchase'
import type { Currency, PartialRates } from '@/server/domain/wholesale/rates'

/* Pure sale rules: line pricing in the sale currency, totals and the ledger split, credit exposure. */

type DD = InstanceType<typeof D>

export const PRICE_MODES = ['OFFICIAL', 'PERCENT', 'MANUAL'] as const
export type PriceMode = (typeof PRICE_MODES)[number]
export const isPriceMode = (v: unknown): v is PriceMode => typeof v === 'string' && (PRICE_MODES as readonly string[]).includes(v)

/** Bad sale/payment input (unknown customer, item, unit or warehouse, bad number, percent, price...). Nothing was written. */
export class InvalidSaleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSaleError'
  }
}

/** The sale is in a state that forbids this (already decided, cancelled, has payments...). Nothing was written. */
export class SaleStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaleStateError'
  }
}

/** A return would take back more of a sale line than it sold (counting every earlier return of that line). */
export class ReturnQtyExceededError extends InvalidSaleError {
  constructor(
    public readonly saleLineId: string,
    public readonly remaining: Decimal,
    public readonly requested: Decimal,
  ) {
    super(`return of ${requested.toFixed()} is more than the ${remaining.toFixed()} still returnable on sale line ${saleLineId}`)
    this.name = 'ReturnQtyExceededError'
  }
}

/** A credit sale would take the customer's open receivable (IQD at the day's rates) above the credit limit. */
export class CreditLimitExceededError extends Error {
  constructor(
    public readonly exposureIqd: Decimal,
    public readonly limitIqd: Decimal,
  ) {
    super(`credit limit exceeded: open receivable would be ${exposureIqd.toFixed()} IQD, limit ${limitIqd.toFixed()} IQD`)
    this.name = 'CreditLimitExceededError'
  }
}

/** parseAmount (strings or Decimals only, never rounded) with sale errors. */
export function parseSaleAmount(v: unknown, o: Parameters<typeof parseAmount>[1]): DD {
  try {
    return parseAmount(v, o)
  } catch (e) {
    if (e instanceof InvalidPurchaseError) throw new InvalidSaleError(e.message)
    throw e
  }
}

const HUNDRED = new D(100)

/** A percent off: 0 <= percent < 100, at most 4 dp (100 would make the price zero, which is never allowed). */
export function parsePercent(v: unknown, label: string): DD {
  const p = parseSaleAmount(v, { label, dp: 4, min: 'zero' })
  if (p.gte(HUNDRED)) throw new InvalidSaleError(`${label} must be below 100`)
  return p
}

export type LinePriceInput = {
  /** Price list price per unit, IQD. */
  officialPriceIqd: Decimal
  qty: Decimal
  mode: PriceMode
  /** PERCENT only (already parsed). */
  percent?: Decimal | null
  /** MANUAL only: the final unit price in the SALE currency (already parsed, > 0, <= 4 dp). */
  manual?: Decimal | null
}

export type PricedSaleLine = {
  /** Per unit, sale currency, 4 dp. */
  officialPrice: DD
  finalPrice: DD
  /** official - final per unit; negative for a premium (manual above official). */
  discount: DD
  /** qty x official, 4 dp. */
  lineOfficial: DD
  /** qty x final, 4 dp: what the customer owes for the line. */
  lineTotal: DD
}

/**
 * Price one line in the sale currency: the IQD list price converted at the day's rates (4 dp), then the price mode
 * (pricing.priceLine) applied to that: OFFICIAL keeps it, PERCENT takes the percent off (4 dp), MANUAL is the entered
 * price as is. A final price that is zero (or rounds to zero) is refused.
 */
export function priceSaleLine(l: LinePriceInput, currency: Currency, rates: PartialRates, label: string): PricedSaleLine {
  const officialPrice = round4(priceInCurrency(l.officialPriceIqd, currency, rates))
  let final: DD
  if (l.mode === 'OFFICIAL') final = officialPrice
  else if (l.mode === 'PERCENT') {
    if (l.percent === undefined || l.percent === null) throw new InvalidSaleError(`${label}: percent is required`)
    final = round4(priceLine({ official: officialPrice, mode: 'PERCENT', percent: l.percent }).final)
  } else {
    if (l.manual === undefined || l.manual === null) throw new InvalidSaleError(`${label}: manual price is required`)
    final = new D(l.manual)
  }
  if (!final.gt(0)) throw new InvalidSaleError(`${label}: the final price must be greater than zero`)
  if (final.decimalPlaces() > AMOUNT_DP) throw new InvalidSaleError(`${label}: price has more than ${AMOUNT_DP} decimal places`)
  const lineOfficial = round4(new D(l.qty).times(officialPrice))
  const lineTotal = round4(new D(l.qty).times(final))
  if (!lineTotal.gt(0)) throw new InvalidSaleError(`${label}: the line total is worth less than 0.0001`)
  if (lineTotal.gte(AMOUNT_MAX) || lineOfficial.gte(AMOUNT_MAX)) throw new InvalidSaleError(`${label}: the line total is too large`)
  return { officialPrice, finalPrice: final, discount: officialPrice.minus(final), lineOfficial, lineTotal }
}

export type SaleTotals = {
  totalOfficial: DD
  totalFinal: DD
  /** totalOfficial - totalFinal (negative when premiums outweigh discounts). */
  totalDiscount: DD
  /** CR SALES: official over the discounted/official lines plus final over the premium lines. */
  salesCredit: DD
  /** DR SALES_DISCOUNT: the positive line discounts. salesCredit = totalFinal + discountDebit. */
  discountDebit: DD
}

export function saleTotals(lines: Pick<PricedSaleLine, 'lineOfficial' | 'lineTotal'>[]): SaleTotals {
  let totalOfficial = new D(0)
  let totalFinal = new D(0)
  let salesCredit = new D(0)
  let discountDebit = new D(0)
  for (const l of lines) {
    totalOfficial = totalOfficial.plus(l.lineOfficial)
    totalFinal = totalFinal.plus(l.lineTotal)
    const disc = new D(l.lineOfficial).minus(l.lineTotal)
    if (disc.isNegative() && !disc.isZero()) salesCredit = salesCredit.plus(l.lineTotal)
    else {
      salesCredit = salesCredit.plus(l.lineOfficial)
      discountDebit = discountDebit.plus(disc)
    }
  }
  if (totalFinal.gte(AMOUNT_MAX) || salesCredit.gte(AMOUNT_MAX)) throw new InvalidSaleError('the sale total is too large')
  return { totalOfficial, totalFinal, totalDiscount: totalOfficial.minus(totalFinal), salesCredit, discountDebit }
}

/** Open receivable in IQD: each document's open amount at its own IQD rate (1 for IQD), summed, rounded once to 4 dp. */
export function exposureIqd(docs: { open: Decimal; rateIqd: Decimal }[]): DD {
  return round4(docs.reduce<DD>((a, x) => a.plus(new D(x.open).times(x.rateIqd)), new D(0)))
}
