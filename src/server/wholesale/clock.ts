import { FutureDateError } from '@/server/domain/wholesale/ledger'
import { baghdadDate } from '@/server/domain/wholesale/rates'

/**
 * The latest date a posting may carry, and the one test seam for it.
 *
 * Rule (production): a document or journal entry may be dated at most today (Asia/Baghdad) plus FUTURE_SLACK_DAYS.
 * The one day of slack covers a client whose clock or timezone is a little ahead around midnight (a form opened at
 * 23:59 and submitted at 00:01 the other side of the date line); anything later, e.g. a typo year, is refused with
 * FutureDateError. Reversals are always dated today (ledger.reverseJournal), so they never hit the rule.
 *
 * Test seam: most DB tests date their documents in their own far-future months so they never collide with each
 * other or with closed periods. tests/setup-clock.ts moves the horizon for those test files with
 * setPostingHorizonForTests; the override works only under Vitest (process.env.VITEST) and never in production
 * (NODE_ENV=production throws), so the production rule cannot be switched off by configuration.
 */
export const FUTURE_SLACK_DAYS = 1

let horizonOverride: string | null = null

const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** The latest allowed posting date ('YYYY-MM-DD'). */
export function latestPostingDate(now: Date = new Date()): string {
  return horizonOverride ?? addDays(baghdadDate(now), FUTURE_SLACK_DAYS)
}

/** Throws FutureDateError when `date` ('YYYY-MM-DD', already validated) is after latestPostingDate(). */
export function assertNotFuture(date: string, now?: Date): void {
  const latest = latestPostingDate(now)
  if (date > latest) throw new FutureDateError(date, latest)
}

/** Tests only (see the header). `null` restores the real rule. */
export function setPostingHorizonForTests(date: string | null): void {
  if (process.env.NODE_ENV === 'production' || !process.env.VITEST) throw new Error('setPostingHorizonForTests is for tests only')
  horizonOverride = date
}
