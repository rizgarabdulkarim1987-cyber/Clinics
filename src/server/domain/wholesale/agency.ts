import Decimal from 'decimal.js'
import { D } from '@/server/domain/wholesale/money'

/*
 * Agency orders: the company imports or sells on behalf of another company (the principal) and keeps a commission.
 * Pure rules, no database. One currency per order, so nothing here converts.
 *
 * Three ledger accounts carry the money (posting/agency.ts):
 * - CUSTOMER_ADVANCES (liability): what the principal paid in advance and the company still holds for him.
 * - AGENCY_RECEIVABLE (asset): what the principal owes the company: costs paid for his goods plus the commission.
 * - AGENCY_COMMISSION (income): the commission, the company's only profit on the order.
 * The goods themselves never touch INVENTORY, COGS or SALES: they are the principal's, not the company's.
 */

export const AGENCY_STATUSES = ['OPEN', 'DELIVERED', 'CLOSED', 'CANCELLED'] as const
export type AgencyStatus = (typeof AGENCY_STATUSES)[number]

export const AGENCY_KINDS = ['ADVANCE', 'COST', 'COMMISSION', 'APPLIED', 'REFUND', 'COLLECTION'] as const
export type AgencyKind = (typeof AGENCY_KINDS)[number]

/** The request is malformed or not allowed in the order's state. */
export class InvalidAgencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAgencyError'
  }
}

export type AgencyRow = { kind: AgencyKind; amount: Decimal | string }

export type AgencyBalance = {
  /** Received in advance and not yet applied or refunded: owed back to the principal. */
  advanceHeld: Decimal
  /** Owed by the principal: costs plus commission, less advances applied and later collections. */
  receivable: Decimal
  advanceReceived: Decimal
  costs: Decimal
  commission: Decimal
}

const dec = (v: Decimal | string): Decimal => new D(v.toString())

/** What the principal has paid, what he owes and what the company holds for him, from the order's rows. */
export function agencyBalance(rows: AgencyRow[]): AgencyBalance {
  const by = (k: AgencyKind) => rows.filter((r) => r.kind === k).reduce((a, r) => a.plus(dec(r.amount)), new D(0))
  const advanceReceived = by('ADVANCE')
  const costs = by('COST')
  const commission = by('COMMISSION')
  return {
    advanceReceived,
    costs,
    commission,
    advanceHeld: advanceReceived.minus(by('APPLIED')).minus(by('REFUND')),
    receivable: costs.plus(commission).minus(by('APPLIED')).minus(by('COLLECTION')),
  }
}

export type SettlementPlan = {
  /** The commission charged now. */
  commission: Decimal
  /** What the principal owes in all once the commission is added: costs + commission. */
  due: Decimal
  /** Advances set against the debt: the smaller of the advances held and the debt. */
  applied: Decimal
  /** Advances beyond the debt, paid back to the principal. */
  refund: Decimal
  /** What is still owed after the advances; zero closes the order. */
  remaining: Decimal
}

/** Applies the advances against costs + commission: the rest is owed (remaining) or paid back (refund). */
export function planSettlement(b: Pick<AgencyBalance, 'advanceHeld' | 'receivable'>, commission: Decimal): SettlementPlan {
  const due = b.receivable.plus(commission)
  const held = b.advanceHeld.lt(0) ? new D(0) : b.advanceHeld
  const applied = Decimal.min(held, due.lt(0) ? new D(0) : due)
  return { commission, due, applied, refund: held.minus(applied), remaining: due.minus(applied) }
}

export function nextStatusAfterCollection(receivable: Decimal): AgencyStatus {
  return receivable.lte(0) ? 'CLOSED' : 'DELIVERED'
}
