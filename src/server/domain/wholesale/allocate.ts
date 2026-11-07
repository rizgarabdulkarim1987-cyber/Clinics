import Decimal from 'decimal.js'
import { D } from '@/server/domain/wholesale/money'

/** Bad allocation input (no weights, negative or all-zero weights, a total with more decimals than `dp`). */
export class AllocationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AllocationError'
  }
}

/**
 * Split `total` (>= 0, at most `dp` decimals) across `weights` in proportion, by the largest-remainder method, at
 * `dp` decimals: every part is the exact share rounded down to `dp`, then the units left over go one each to the
 * parts with the largest dropped remainders (ties to the earlier index). So the parts always sum EXACTLY to `total`
 * and each is within one unit of the `dp`-th decimal of its exact share. A zero weight gets 0; at least one weight
 * must be > 0. Pure; uses the 40-digit D.
 */
export function allocate(total: Decimal, weights: Decimal[], dp = 4): Decimal[] {
  if (!Decimal.isDecimal(total) || !total.isFinite()) throw new AllocationError('total must be a finite Decimal')
  if (total.isNegative() && !total.isZero()) throw new AllocationError('total must not be negative')
  if (total.decimalPlaces() > dp) throw new AllocationError(`total has more than ${dp} decimal places`)
  if (!Array.isArray(weights) || weights.length === 0) throw new AllocationError('at least one weight is required')
  const ws = weights.map((w, i) => {
    if (!Decimal.isDecimal(w) || !w.isFinite()) throw new AllocationError(`weight ${i + 1} must be a finite Decimal`)
    if (w.isNegative() && !w.isZero()) throw new AllocationError(`weight ${i + 1} must not be negative`)
    return new D(w)
  })
  const W = ws.reduce((a, b) => a.plus(b), new D(0))
  if (!W.gt(0)) throw new AllocationError('weights must not all be zero')

  const scale = new D(10).pow(dp)
  const units = new D(total).times(scale) // an integer: total has at most dp decimals
  const exact = ws.map((w) => units.times(w).div(W))
  const floors = exact.map((x) => x.floor())
  let left = units.minus(floors.reduce((a, b) => a.plus(b), new D(0))).toNumber() // < weights.length
  const order = exact.map((x, i) => ({ i, rem: x.minus(floors[i]) })).sort((a, b) => b.rem.comparedTo(a.rem) || a.i - b.i)
  const parts = [...floors]
  for (const o of order) {
    if (left <= 0) break
    parts[o.i] = parts[o.i].plus(1)
    left--
  }
  return parts.map((p) => {
    const v = p.div(scale)
    return v.isZero() ? new D(0) : v
  })
}
