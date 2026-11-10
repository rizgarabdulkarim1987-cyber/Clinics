/** Where a batch stands against its expiry date: already past, inside the warning window, or still far off. */
export type ExpiryStatus = 'expired' | 'soon' | 'ok';

const DAY_MS = 86_400_000;

/** Whole days from `today` to `expiry` (both `YYYY-MM-DD`); negative once the date has passed. */
export function daysUntil(expiry: string, today: string): number {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export function expiryStatus(daysLeft: number, alertDays: number): ExpiryStatus {
  return daysLeft < 0 ? 'expired' : daysLeft <= alertDays ? 'soon' : 'ok';
}
