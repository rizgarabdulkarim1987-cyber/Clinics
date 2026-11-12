import { describe, expect, it } from 'vitest';
import { poolConfig } from '@/server/data/prisma';

describe('poolConfig', () => {
  it('bounds the pool and every wait, so one slow query or a dead database cannot hold every request open', () => {
    const config = poolConfig('postgresql://x', {});
    expect(config.connectionString).toBe('postgresql://x');
    expect(config.max).toBe(10);
    expect(config.connectionTimeoutMillis).toBe(5_000);
    expect(config.idleTimeoutMillis).toBe(30_000);
    expect(config.statement_timeout).toBe(30_000);
    expect(config.query_timeout).toBeGreaterThan(config.statement_timeout as number);
  });

  it('takes the pool size and the statement timeout from the environment', () => {
    const config = poolConfig('postgresql://x', { DB_POOL_MAX: '4', DB_STATEMENT_TIMEOUT_MS: '8000' });
    expect(config.max).toBe(4);
    expect(config.statement_timeout).toBe(8_000);
  });

  it('ignores values that are not positive whole numbers', () => {
    const config = poolConfig('postgresql://x', { DB_POOL_MAX: '0', DB_STATEMENT_TIMEOUT_MS: 'soon' });
    expect(config.max).toBe(10);
    expect(config.statement_timeout).toBe(30_000);
  });
});
