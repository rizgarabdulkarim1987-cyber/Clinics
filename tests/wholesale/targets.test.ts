import { describe, expect, it } from 'vitest';
import { achievedOf, monthProgress, monthRange, percentOf } from '@/server/domain/wholesale/targets';

describe('rep targets', () => {
  it('adds amount, weight, pieces and each item across sales', () => {
    const done = achievedOf([
      { amountIqd: 1000, lines: [{ itemId: 'rice', baseUnit: 'KG', qtyBase: 25 }, { itemId: 'tea', baseUnit: 'PIECE', qtyBase: 10 }] },
      { amountIqd: 500, lines: [{ itemId: 'rice', baseUnit: 'KG', qtyBase: 5 }, { itemId: 'oil', baseUnit: 'CARTON', qtyBase: 2 }, { itemId: 'sugar', baseUnit: 'TON', qtyBase: 1 }] },
    ]);
    expect(done.amountIqd).toBe(1500);
    expect(done.weightKg).toBe(25 + 5 + 1000);
    expect(done.pieces).toBe(10);
    expect(done.items).toEqual({ rice: 30, tea: 10, oil: 2, sugar: 1 });
  });

  it('percent is null without a target and passes 100 when beaten', () => {
    expect(percentOf(50, null)).toBeNull();
    expect(percentOf(50, 0)).toBeNull();
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(300, 200)).toBe(150);
  });

  it('knows a month range and how far the month has gone', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02').to).toBe('2028-02-29');
    expect(monthProgress('2026-11-15', '2026-11')).toBe(50);
    expect(monthProgress('2026-10-31', '2026-11')).toBe(0);
    expect(monthProgress('2026-12-01', '2026-11')).toBe(100);
    expect(() => monthRange('2026-13')).toThrow();
  });
});
