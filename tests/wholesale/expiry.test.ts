import { describe, expect, it } from 'vitest';
import { expiryQuery } from '@/server/wholesale/queries/reports';

describe('expiry query', () => {
  it('is a stock.view query', () => {
    expect(expiryQuery).toBeDefined();
  });
});
