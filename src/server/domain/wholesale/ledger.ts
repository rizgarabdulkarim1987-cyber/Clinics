import Decimal from 'decimal.js'
import { CURRENCIES, RATE_DP, type Currency, type PartialRates } from '@/server/domain/wholesale/rates'
import { D, toIqd } from '@/server/domain/wholesale/money'

/* ------------------------------------------------------------------ types */

export type Side = 'DR' | 'CR'
export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'CONTRA'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]
export type LocalizedName = { ckb: string; ar: string; en: string }

/**
 * One line as a caller supplies it. `amount` is always positive; `side` carries the sign.
 * `rateIqd` (optional, foreign-currency lines only) pins the IQD-per-unit rate for this line instead of the entry
 * date's rate: used to carry a debt at the rate it was booked at (a supplier payment debits AP at the purchase's
 * locked rate; the gap to the cash paid at today's rate is posted to FX_GAIN/FX_LOSS by the caller).
 */
export type LineInput = { accountCode: string; side: Side; amount: Decimal; currency: Currency; partyId?: string; rateIqd?: Decimal }

/** A line ready to store: the rate used and the IQD value at storage precision. */
export type PricedLine = LineInput & { rateIqd: Decimal; baseIqd: Decimal }

/* ----------------------------------------------------------------- errors */

/** The entry's debits and credits differ by 0.01 IQD or more (after conversion to IQD). */
export class UnbalancedEntryError extends Error {
  constructor(
    public readonly debitIqd: string,
    public readonly creditIqd: string,
  ) {
    super(`unbalanced journal entry: DR ${debitIqd} IQD vs CR ${creditIqd} IQD`)
    this.name = 'UnbalancedEntryError'
  }
}

/** Malformed entry: bad amount, side, currency, date, memo, source, or fewer than two lines. */
export class InvalidEntryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidEntryError'
  }
}

/**
 * A document or entry dated after the latest allowed posting date (today in Asia/Baghdad plus one day of slack for
 * clock/timezone edges, see server/clock.ts). A typo year (2062 for 2026) would otherwise post into a far-future
 * month that nobody closes. Subclass of InvalidEntryError so every caller that maps "invalid" still catches it.
 */
export class FutureDateError extends InvalidEntryError {
  constructor(
    public readonly date: string,
    public readonly latest: string,
  ) {
    super(`date ${date} is in the future (latest allowed: ${latest})`)
    this.name = 'FutureDateError'
  }
}

/** A line names an account code that is not in the chart of accounts (or is a non-postable group). */
export class UnknownAccountError extends Error {
  constructor(
    public readonly code: string,
    detail = 'unknown account code',
  ) {
    super(`${detail}: ${code}`)
    this.name = 'UnknownAccountError'
  }
}

/** The accounting date falls in a month that is currently closed. */
export class PeriodClosedError extends Error {
  constructor(
    public readonly month: string,
    public readonly date: string,
  ) {
    super(`period ${month} is closed (entry date ${date})`)
    this.name = 'PeriodClosedError'
  }
}

/** Closing a closed month, reopening an open one, or a malformed month. */
export class PeriodStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PeriodStateError'
  }
}

/** An entry cannot be reversed (missing, or itself a reversal). */
export class ReversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReversalError'
  }
}

/** A line's currency differs from the fixed currency of its account (e.g. a USD line to CASH_IQD). */
export class CurrencyMismatchError extends Error {
  constructor(
    public readonly accountCode: string,
    public readonly expected: Currency,
    public readonly got: Currency,
  ) {
    super(`account ${accountCode} holds ${expected} only, got a ${got} line`)
    this.name = 'CurrencyMismatchError'
  }
}

/** The entry already has a reversal. */
export class AlreadyReversedError extends ReversalError {
  constructor(public readonly entryId: string) {
    super(`journal entry ${entryId} is already reversed`)
    this.name = 'AlreadyReversedError'
  }
}

/* ---------------------------------------------------------- posting rules */

/** Storage precision of amount and baseIqd: Decimal(24,4). */
export const AMOUNT_DP = 4
/**
 * Per-line cap, both for `amount` and for its IQD value (exclusive): 1e15. Far above any real document (IRT amounts
 * of 10-11 digits included), well inside Decimal(24,4), and it keeps every sum of lines exact in the 40-digit `D`.
 */
export const AMOUNT_MAX = new D('1e15')
/** A stored-value imbalance below this (IQD) is posted to ROUNDING; at or above it the entry is refused. */
export const ROUNDING_TOLERANCE_IQD = new Decimal('0.01')
export const ROUNDING_ACCOUNT = 'ROUNDING'
/** Rates are Decimal(18,8). */
const RATE_MAX = new D('1e10')

function validateLine(l: LineInput, i: number): void {
  const at = `line ${i + 1}`
  if (!l || typeof l !== 'object') throw new InvalidEntryError(`${at}: not a line`)
  if (typeof l.accountCode !== 'string' || !l.accountCode.trim()) throw new InvalidEntryError(`${at}: account code is required`)
  if (l.side !== 'DR' && l.side !== 'CR') throw new InvalidEntryError(`${at}: side must be DR or CR`)
  if (!(CURRENCIES as readonly string[]).includes(l.currency)) throw new InvalidEntryError(`${at}: unknown currency ${String(l.currency)}`)
  if (!Decimal.isDecimal(l.amount)) throw new InvalidEntryError(`${at}: amount must be a Decimal`)
  if (!l.amount.isFinite() || !l.amount.gt(0)) throw new InvalidEntryError(`${at}: amount must be a positive number`)
  if (l.amount.decimalPlaces() > AMOUNT_DP) throw new InvalidEntryError(`${at}: amount has more than ${AMOUNT_DP} decimal places`)
  if (l.amount.gte(AMOUNT_MAX)) throw new InvalidEntryError(`${at}: amount must be below ${AMOUNT_MAX.toFixed()}`)
  if (l.partyId !== undefined && (typeof l.partyId !== 'string' || !l.partyId)) throw new InvalidEntryError(`${at}: bad partyId`)
  if (l.rateIqd !== undefined) {
    const r = l.rateIqd
    if (l.currency === 'IQD') throw new InvalidEntryError(`${at}: an IQD line cannot pin a rate`)
    if (!Decimal.isDecimal(r) || !r.isFinite() || !r.gt(0)) throw new InvalidEntryError(`${at}: pinned rate must be a positive Decimal`)
    if (r.decimalPlaces() > RATE_DP || r.gte(RATE_MAX)) throw new InvalidEntryError(`${at}: pinned rate does not fit Decimal(18,8)`)
  }
}

/** Validate shape only (no rates needed). Throws InvalidEntryError. */
export function validateLines(lines: LineInput[]): void {
  if (!Array.isArray(lines) || lines.length < 2) throw new InvalidEntryError('an entry needs at least two lines')
  lines.forEach(validateLine)
  // ROUNDING may only absorb a residue between real debits and credits, never stand in for a whole side.
  if (!lines.some((l) => l.side === 'DR') || !lines.some((l) => l.side === 'CR'))
    throw new InvalidEntryError('an entry needs at least one DR and one CR line')
}

/** The distinct currencies whose day rate the lines need (pinned-rate lines need none): what postJournal asks requireRates for. */
export function currenciesOf(lines: LineInput[]): Currency[] {
  return [...new Set(lines.filter((l) => l.rateIqd === undefined).map((l) => l.currency))]
}

/** Exact sum in the 40-digit D (never the 20-digit global Decimal). */
const sum = (xs: Decimal[]) => xs.reduce<Decimal>((a, b) => a.plus(b), new D(0))

/**
 * Convert every line to IQD and balance the entry.
 *
 * Rule: baseIqd = amount * rateIqd, rounded ONCE to 4 dp half-up (the stored precision). Balance is checked on
 * those stored values. If |ΣDR − ΣCR| is zero, done; if it is non-zero but below 0.01 IQD, one IQD line to
 * ROUNDING is appended on the short side for exactly the difference; at 0.01 IQD or more UnbalancedEntryError.
 * So every stored entry balances exactly on baseIqd. All arithmetic uses the 40-digit D: with lines capped below
 * 1e15 at 4 dp, products and sums are exact.
 */
export function priceLines(lines: LineInput[], rates: PartialRates): PricedLine[] {
  validateLines(lines)
  const priced: PricedLine[] = lines.map((l, i) => {
    const rateIqd =
      l.currency === 'IQD' ? new D(1) : l.rateIqd !== undefined ? new D(l.rateIqd) : new D(toIqd({ amount: new D(1), currency: l.currency }, rates))
    const baseIqd = new D(l.amount).times(rateIqd).toDecimalPlaces(AMOUNT_DP, D.ROUND_HALF_UP)
    if (!baseIqd.gt(0)) throw new InvalidEntryError(`line ${i + 1}: amount is worth less than 0.0001 IQD`)
    if (baseIqd.gte(AMOUNT_MAX)) throw new InvalidEntryError(`line ${i + 1}: IQD value must be below ${AMOUNT_MAX.toFixed()}`)
    const out: PricedLine = { accountCode: l.accountCode, side: l.side, amount: new D(l.amount), currency: l.currency, rateIqd, baseIqd }
    if (l.partyId !== undefined) out.partyId = l.partyId
    return out
  })
  const dr = sum(priced.filter((l) => l.side === 'DR').map((l) => l.baseIqd))
  const cr = sum(priced.filter((l) => l.side === 'CR').map((l) => l.baseIqd))
  const diff = dr.minus(cr)
  if (diff.isZero()) return priced
  if (diff.abs().gte(ROUNDING_TOLERANCE_IQD)) throw new UnbalancedEntryError(dr.toFixed(), cr.toFixed())
  const amount = diff.abs()
  priced.push({ accountCode: ROUNDING_ACCOUNT, side: diff.gt(0) ? 'CR' : 'DR', amount, currency: 'IQD', rateIqd: new D(1), baseIqd: amount })
  return priced
}

/** Lines of a reversing entry: same account, amount, currency, rate and baseIqd, opposite side. */
export function mirrorLines<T extends { side: Side }>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, side: l.side === 'DR' ? 'CR' : 'DR' }))
}

/* -------------------------------------------------------- chart of accounts */

/** `currency` set = the account only takes lines in that currency (cash boxes); unset = any currency. */
export type AccountDef = {
  code: string
  type: AccountType
  normalSide: Side
  name: LocalizedName
  parentCode?: string
  postable?: boolean
  currency?: Currency
}

/** Codes later tasks post to. */
export const REQUIRED_ACCOUNT_CODES = [
  'CASH_IQD',
  'CASH_USD',
  'CASH_IRT',
  'INVENTORY',
  'AR',
  'AP',
  'REP_CUSTODY',
  'SALES',
  'COGS',
  'DAMAGE_LOSS',
  'FX_GAIN',
  'FX_LOSS',
  'SALES_DISCOUNT',
  'EXPENSE_RENT',
  'EXPENSE_SALARIES',
  'EXPENSE_FUEL',
  'EXPENSE_TRANSPORT',
  'EXPENSE_UTILITIES',
  'EXPENSE_OTHER',
  'PARTNER_CAPITAL',
  'PARTNER_DRAW',
  'ROUNDING',
  'STOCK_ADJUSTMENT',
  'PURCHASE_RETURN_LOSS',
] as const
export type AccountCode = (typeof REQUIRED_ACCOUNT_CODES)[number]

/** Seeded chart of accounts (prisma/seed.ts). Parents come before children. CONTRA = contra-income (DR-normal). */
export const CHART_OF_ACCOUNTS: readonly AccountDef[] = [
  { code: 'CASH', type: 'ASSET', normalSide: 'DR', postable: false, name: { ckb: 'قاسە', ar: 'الصندوق', en: 'Cash' } },
  { code: 'CASH_IQD', type: 'ASSET', normalSide: 'DR', parentCode: 'CASH', currency: 'IQD', name: { ckb: 'قاسەی دیناری عێراقی', ar: 'الصندوق - دينار عراقي', en: 'Cash (IQD)' } },
  { code: 'CASH_USD', type: 'ASSET', normalSide: 'DR', parentCode: 'CASH', currency: 'USD', name: { ckb: 'قاسەی دۆلاری ئەمریکی', ar: 'الصندوق - دولار أمريكي', en: 'Cash (USD)' } },
  { code: 'CASH_IRT', type: 'ASSET', normalSide: 'DR', parentCode: 'CASH', currency: 'IRT', name: { ckb: 'قاسەی تمەنی ئێرانی', ar: 'الصندوق - تومان إيراني', en: 'Cash (IRT)' } },
  { code: 'INVENTORY', type: 'ASSET', normalSide: 'DR', name: { ckb: 'کاڵای کۆگا', ar: 'المخزون', en: 'Inventory' } },
  { code: 'AR', type: 'ASSET', normalSide: 'DR', name: { ckb: 'قەرزی لای کڕیاران', ar: 'ذمم العملاء', en: 'Accounts receivable' } },
  { code: 'REP_CUSTODY', type: 'ASSET', normalSide: 'DR', name: { ckb: 'پارەی لای نوێنەرانی فرۆشتن', ar: 'عهدة المندوبين', en: 'Sales rep custody' } },
  { code: 'AP', type: 'LIABILITY', normalSide: 'CR', name: { ckb: 'قەرزی دابینکەران', ar: 'ذمم الموردين', en: 'Accounts payable' } },
  // Agency orders (the company handles an order for another company): advances held for it, what it still owes the
  // company (costs paid for it plus commission, less advances), and the commission the company keeps.
  { code: 'CUSTOMER_ADVANCES', type: 'LIABILITY', normalSide: 'CR', name: { ckb: 'پێشەکی کڕیاران', ar: 'دفعات مقدمة من العملاء', en: 'Customer advances' } },
  { code: 'AGENCY_RECEIVABLE', type: 'ASSET', normalSide: 'DR', name: { ckb: 'قەرزی لای ئەو کۆمپانیایانەی بۆیان دەکڕین', ar: 'مستحقات الوكالة على الموكلين', en: 'Agency receivable' } },
  { code: 'AGENCY_COMMISSION', type: 'INCOME', normalSide: 'CR', name: { ckb: 'کۆمیسیۆنی بەرەڵاکردن', ar: 'عمولة الوكالة', en: 'Agency commission' } },
  { code: 'PARTNER_CAPITAL', type: 'EQUITY', normalSide: 'CR', name: { ckb: 'سەرمایەی هاوبەشان', ar: 'رأس مال الشركاء', en: "Partners' capital" } },
  { code: 'PARTNER_DRAW', type: 'EQUITY', normalSide: 'DR', name: { ckb: 'ڕاکێشانی هاوبەشان', ar: 'مسحوبات الشركاء', en: "Partners' drawings" } },
  { code: 'SALES', type: 'INCOME', normalSide: 'CR', name: { ckb: 'فرۆشتن', ar: 'المبيعات', en: 'Sales' } },
  { code: 'SALES_DISCOUNT', type: 'CONTRA', normalSide: 'DR', name: { ckb: 'داشکاندنی فرۆشتن', ar: 'خصم المبيعات', en: 'Sales discounts' } },
  { code: 'FX_GAIN', type: 'INCOME', normalSide: 'CR', name: { ckb: 'قازانجی جیاوازی نرخی دراو', ar: 'أرباح فروق العملة', en: 'Foreign exchange gain' } },
  { code: 'COGS', type: 'EXPENSE', normalSide: 'DR', name: { ckb: 'تێچووی کاڵای فرۆشراو', ar: 'تكلفة البضاعة المباعة', en: 'Cost of goods sold' } },
  { code: 'DAMAGE_LOSS', type: 'EXPENSE', normalSide: 'DR', name: { ckb: 'زیانی کاڵای تێکچوو', ar: 'خسائر التلف', en: 'Damaged goods loss' } },
  { code: 'FX_LOSS', type: 'EXPENSE', normalSide: 'DR', name: { ckb: 'زیانی جیاوازی نرخی دراو', ar: 'خسائر فروق العملة', en: 'Foreign exchange loss' } },
  // Stock count differences: a shortage is debited, a surplus credited (net P&L of counts).
  { code: 'STOCK_ADJUSTMENT', type: 'EXPENSE', normalSide: 'DR', name: { ckb: 'جیاوازی ژمێرینی کۆگا', ar: 'فروقات جرد المخزون', en: 'Stock count differences' } },
  // The landed-cost part of goods returned to a supplier (freight, customs...): not refunded, written off.
  { code: 'PURCHASE_RETURN_LOSS', type: 'EXPENSE', normalSide: 'DR', name: { ckb: 'زیانی گەڕاندنەوەی کڕین', ar: 'خسائر مرتجعات المشتريات', en: 'Purchase return loss' } },
  { code: 'EXPENSES', type: 'EXPENSE', normalSide: 'DR', postable: false, name: { ckb: 'خەرجییەکان', ar: 'المصاريف', en: 'Expenses' } },
  { code: 'EXPENSE_RENT', type: 'EXPENSE', normalSide: 'DR', parentCode: 'EXPENSES', name: { ckb: 'کرێ', ar: 'الإيجار', en: 'Rent' } },
  { code: 'EXPENSE_SALARIES', type: 'EXPENSE', normalSide: 'DR', parentCode: 'EXPENSES', name: { ckb: 'مووچە', ar: 'الرواتب', en: 'Salaries' } },
  { code: 'EXPENSE_FUEL', type: 'EXPENSE', normalSide: 'DR', parentCode: 'EXPENSES', name: { ckb: 'سووتەمەنی', ar: 'الوقود', en: 'Fuel' } },
  { code: 'EXPENSE_TRANSPORT', type: 'EXPENSE', normalSide: 'DR', parentCode: 'EXPENSES', name: { ckb: 'گواستنەوە', ar: 'النقل', en: 'Transport' } },
  { code: 'EXPENSE_UTILITIES', type: 'EXPENSE', normalSide: 'DR', parentCode: 'EXPENSES', name: { ckb: 'کارەبا و ئاو', ar: 'الكهرباء والماء', en: 'Utilities' } },
  { code: 'EXPENSE_OTHER', type: 'EXPENSE', normalSide: 'DR', parentCode: 'EXPENSES', name: { ckb: 'خەرجی تر', ar: 'مصاريف أخرى', en: 'Other expenses' } },
  { code: 'ROUNDING', type: 'EXPENSE', normalSide: 'DR', name: { ckb: 'جیاوازی خڕکردنەوە', ar: 'فروق التقريب', en: 'Rounding differences' } },
]
