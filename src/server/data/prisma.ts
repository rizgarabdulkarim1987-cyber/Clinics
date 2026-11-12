import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

/** The embedded development database started by `npm run db:up`. Never used in production. */
const DEV_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54329/buzzify';

function defaultConnectionString(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return process.env.NODE_ENV === 'production' ? undefined : DEV_DATABASE_URL;
}

/** A positive whole number from the environment, or the fallback. */
function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * The connection pool's limits. Every wait is bounded, so a slow query or an unreachable database fails one request
 * quickly instead of holding every request (menu, Studio, till) open behind it. Overridable with `DB_POOL_MAX` and
 * `DB_STATEMENT_TIMEOUT_MS`.
 */
export function poolConfig(connectionString: string, env: Record<string, string | undefined> = process.env) {
  const statementTimeout = positive(env.DB_STATEMENT_TIMEOUT_MS, 30_000);
  return {
    connectionString,
    max: positive(env.DB_POOL_MAX, 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: statementTimeout,
    // The client gives up a little after the server would, so the server's error is the one that surfaces.
    query_timeout: statementTimeout + 5_000,
  };
}

export function createPrisma(connectionString: string | undefined = defaultConnectionString()): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  return new PrismaClient({ adapter: new PrismaPg(poolConfig(connectionString)) });
}

export function getPrisma(): PrismaClient {
  globalForPrisma.__prisma ??= createPrisma();
  return globalForPrisma.__prisma;
}
