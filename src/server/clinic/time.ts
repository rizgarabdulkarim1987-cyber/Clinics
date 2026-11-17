/**
 * The clinic's clock. A clinic's day is Baghdad's: UTC+3 all year (Iraq keeps no daylight saving). Times are stored in
 * UTC; everything that turns a stored time into "which day" or "which minute of the day" goes through here, so there
 * is one place to change if a clinic in another zone is ever served.
 */
export const CL_OFFSET_MIN = 180;
const MINUTE = 60_000;

export const isDay = (day: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));

/** The UTC instant a clinic day starts at `minutes` after its local midnight. */
export function fromLocal(day: string, minutes: number): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) + minutes * MINUTE - CL_OFFSET_MIN * MINUTE);
}

/** The clinic's date (YYYY-MM-DD) of an instant. */
export function localDay(at: Date): string {
  return new Date(at.getTime() + CL_OFFSET_MIN * MINUTE).toISOString().slice(0, 10);
}

/** Minutes after the clinic's local midnight. */
export function localMinutes(at: Date): number {
  const local = new Date(at.getTime() + CL_OFFSET_MIN * MINUTE);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** Sunday is 0, as the working hours store it. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The UTC range of a clinic day. */
export function dayRange(day: string): { start: Date; end: Date } {
  return { start: fromLocal(day, 0), end: fromLocal(day, 1440) };
}

/** Bookable times start on this grid, in minutes. */
export const SLOT_STEP_MIN = 15;
