import Decimal from 'decimal.js'
import { D } from '@/server/domain/wholesale/money'

/*
 * Special orders (agency orders): a customer asks the company to bring a product from abroad (say rice from
 * Kazakhstan), pays an advance, and takes the goods and pays the whole total when they arrive. It is a SALE to that
 * customer, so its profit or loss belongs in the sales figures. Pure rules, no database; one currency per order.
 *
 * Ledger (posting/agency.ts): the advance is a liability (CUSTOMER_ADVANCES) until delivery; what the company pays to
 * get the goods sits in AGENCY_WIP (an asset, "orders in progress") until delivery; at delivery the final total goes to
 * SALES and the cost to COGS, so the profit report shows profit or loss like any other sale. Whatever the customer
 * still owes after his advances is AGENCY_RECEIVABLE.
 */

export const AGENCY_STATUSES = ['OPEN', 'DELIVERED', 'CLOSED', 'CANCELLED'] as const
export type AgencyStatus = (typeof AGENCY_STATUSES)[number]

export const AGENCY_KINDS = ['ADVANCE', 'COST', 'SALE', 'APPLIED', 'REFUND', 'COLLECTION', 'COMMISSION'] as const

/** What a cost is for: the goods, shipping, customs or anything else. All of them are the order's cost. */
export const COST_CATEGORIES = ['GOODS', 'SHIPPING', 'CUSTOMS', 'OTHER'] as const
export type CostCategory = (typeof COST_CATEGORIES)[number]
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
  /** Received in advance and not yet applied or refunded: owed back to the customer. */
  advanceHeld: Decimal
  /** Owed by the customer after delivery: the final total, less advances applied and later payments. */
  receivable: Decimal
  advanceReceived: Decimal
  /** What the company paid to get the goods (its own cost). */
  costs: Decimal
  /** The final sale total once delivered (0 before). */
  saleTotal: Decimal
  /** Sale total less costs once delivered: negative is a loss. */
  profit: Decimal
}

const dec = (v: Decimal | string): Decimal => new D(v.toString())

/** What the customer has paid, what he owes and what the deal earned, from the order's rows. */
export function agencyBalance(rows: AgencyRow[]): AgencyBalance {
  const by = (k: AgencyKind) => rows.filter((r) => r.kind === k).reduce((a, r) => a.plus(dec(r.amount)), new D(0))
  const advanceReceived = by('ADVANCE')
  const costs = by('COST')
  const saleTotal = by('SALE')
  return {
    advanceReceived,
    costs,
    saleTotal,
    profit: saleTotal.gt(0) ? saleTotal.minus(costs) : new D(0),
    advanceHeld: advanceReceived.minus(by('APPLIED')).minus(by('REFUND')),
    receivable: saleTotal.minus(by('APPLIED')).minus(by('COLLECTION')),
  }
}

export type SettlementPlan = {
  /** The final total the customer pays for the delivered goods. */
  total: Decimal
  /** Advances set against it: the smaller of the advances held and the total. */
  applied: Decimal
  /** Advances beyond the total, paid back. */
  refund: Decimal
  /** What is still owed after the advances; zero closes the order. */
  remaining: Decimal
  /** The company's own cost so far and the result: total - cost (negative = loss). */
  cost: Decimal
  profit: Decimal
}

/** Delivery: the total is the sale; the advances pay part of it, the rest is owed (or the excess advance goes back). */
export function planSettlement(b: Pick<AgencyBalance, 'advanceHeld' | 'costs'>, total: Decimal): SettlementPlan {
  const held = b.advanceHeld.lt(0) ? new D(0) : b.advanceHeld
  const applied = Decimal.min(held, total)
  return { total, applied, refund: held.minus(applied), remaining: total.minus(applied), cost: b.costs, profit: total.minus(b.costs) }
}

export function nextStatusAfterCollection(receivable: Decimal): AgencyStatus {
  return receivable.lte(0) ? 'CLOSED' : 'DELIVERED'
}
