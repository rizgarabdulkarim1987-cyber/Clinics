import { describe, expect, it } from 'vitest';
import { daysUntil, expiryStatus } from '@/server/domain/wholesale/expiry';

describe('expiry', () => {
  it('counts whole days, negative once past', () => {
    expect(daysUntil('2026-11-10', '2026-11-10')).toBe(0);
    expect(daysUntil('2026-11-20', '2026-11-10')).toBe(10);
    expect(daysUntil('2026-11-09', '2026-11-10')).toBe(-1);
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('is expired only after the date, soon up to and including the alert days', () => {
    expect(expiryStatus(-1, 30)).toBe('expired');
    expect(expiryStatus(0, 30)).toBe('soon');
    expect(expiryStatus(30, 30)).toBe('soon');
    expect(expiryStatus(31, 30)).toBe('ok');
  });
});
