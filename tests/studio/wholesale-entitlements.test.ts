import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import * as wholesaleActions from '@/server/studio/actions/wholesale';
import * as wholesaleQueries from '@/server/studio/queries/wholesale';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { entitlementsRoute } from '@/server/wholesale/entitlements-http';
import { bearerSecret, hashSecret, newSecret } from '@/server/wholesale/service-client';
import { seedApplications } from '../../prisma/seed/applications';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/**
 * Core answers the question a separate product asks (`GET /api/v1/entitlements/{businessId}/{applicationId}`): is this
 * company's subscription live? Authenticated by a service secret that belongs to one application and is kept only as a hash.
 */

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const prisma = () => getPrisma();
const DAY = 86_400_000;
const NOW = new Date('2026-11-07T09:00:00.000Z');

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const act = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, { ip: '203.0.113.9', userAgent: 'vitest' });
const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown = {}) => runQuery(prisma(), actor, def, input);

async function person(id: string, platformOwner: boolean): Promise<Actor> {
  await prisma().user.create({ data: { id, name: id, email: `${id}@example.com`, isSuperAdmin: true, isPlatformOwner: platformOwner, twoFactorEnabled: true } });
  return (await loadActor(prisma(), id)) as Actor;
}

let company: { id: string };
let secret: string;

const call = (businessId: string, applicationId: string, headers: Record<string, string> = { authorization: `Bearer ${secret}` }) =>
  entitlementsRoute(new Request(`https://studio.example/api/v1/entitlements/${businessId}/${applicationId}`, { headers }), businessId, applicationId, prisma(), NOW);

async function subscribe(status: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED', end: Date, trialEndsAt: Date | null = null) {
  await prisma().subscription.create({
    data: {
      restaurantId: company.id,
      applicationId: 'wholesale',
      planCode: 'standard',
      status,
      period: 'YEARLY',
      currency: 'USD',
      priceMinor: 200000,
      trialEndsAt,
      currentPeriodStart: new Date(end.getTime() - 365 * DAY),
      currentPeriodEnd: end,
      graceDays: 7,
      version: 1,
    },
  });
}

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  await resetTestData(prisma());
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await seedApplications(prisma());
  company = await prisma().restaurant.create({ data: { name: 'Company Delta', sector: 'WHOLESALE' } });
  await prisma().wholesaleLink.create({ data: { restaurantId: company.id } });
  secret = newSecret();
  await prisma().serviceClient.create({ data: { applicationId: 'wholesale', name: 'Wholesale', secretHash: hashSecret(secret) } });
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await resetTestData(prisma());
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

describe('the secret', () => {
  it('is bzc_ and long, and only a well-formed Bearer header yields one', () => {
    expect(newSecret()).toMatch(/^bzc_[A-Za-z0-9_-]{40,}$/);
    expect(newSecret()).not.toBe(newSecret());
    expect(bearerSecret(`Bearer ${secret}`)).toBe(secret);
    for (const header of [null, '', secret, `Basic ${secret}`, 'Bearer ', 'Bearer abc', `bearer ${secret}`, `Bearer ${secret} x`]) expect(bearerSecret(header), String(header)).toBeNull();
  });
});

describe('GET /api/v1/entitlements/{businessId}/{applicationId}', () => {
  it('refuses a missing, wrong or revoked secret alike with 401, and tells nothing about the business', async () => {
    const bodies = [];
    const wrong: Record<string, string>[] = [{}, { authorization: 'Bearer nope' }, { authorization: `Bearer ${newSecret()}` }];
    for (const headers of wrong) {
      const res = await call(company.id, 'wholesale', headers);
      expect(res.status).toBe(401);
      bodies.push(await res.json());
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(bodies[0]).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });

    await prisma().serviceClient.updateMany({ data: { revokedAt: NOW } });
    expect((await call(company.id, 'wholesale')).status).toBe(401);
  });

  it('refuses a secret of another application with 403', async () => {
    const other = newSecret();
    await prisma().serviceClient.create({ data: { applicationId: 'pharmacy', name: 'Other', secretHash: hashSecret(other) } });
    const res = await call(company.id, 'wholesale', { authorization: `Bearer ${other}` });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('answers 404 for an unknown business and for a business that is not a wholesale company with a link', async () => {
    const cafe = await prisma().restaurant.create({ data: { name: 'Cafe' } });
    const bare = await prisma().restaurant.create({ data: { name: 'Bare', sector: 'WHOLESALE' } });
    for (const business of ['missing', cafe.id, bare.id]) {
      const res = await call(business, 'wholesale');
      expect(res.status, business).toBe(404);
      expect((await res.json()).error.code).toBe('NOT_FOUND');
    }
  });

  it('says NONE and not active for a company with no subscription', async () => {
    const res = await call(company.id, 'wholesale');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      businessId: company.id,
      applicationId: 'wholesale',
      status: 'NONE',
      active: false,
      plan: null,
      features: [],
      limits: {},
      validUntil: null,
      graceEndsAt: null,
      checkedAt: NOW.toISOString(),
    });
  });

  it('is active on a trial until the trial ends', async () => {
    const trialEnd = new Date(NOW.getTime() + 5 * DAY);
    await subscribe('TRIAL', new Date(NOW.getTime() + 30 * DAY), trialEnd);
    const body = await (await call(company.id, 'wholesale')).json();
    expect(body).toMatchObject({ status: 'TRIAL', active: true, plan: 'standard', validUntil: trialEnd.toISOString(), graceEndsAt: null });
  });

  it('is active while paid, active through the grace days, and read-only after', async () => {
    await subscribe('ACTIVE', new Date(NOW.getTime() + 100 * DAY));
    expect(await (await call(company.id, 'wholesale')).json()).toMatchObject({ status: 'ACTIVE', active: true });
    await prisma().subscription.deleteMany({});

    const ended = new Date(NOW.getTime() - 3 * DAY);
    await subscribe('ACTIVE', ended);
    const grace = await (await call(company.id, 'wholesale')).json();
    expect(grace).toMatchObject({ status: 'GRACE', active: true, validUntil: ended.toISOString(), graceEndsAt: new Date(ended.getTime() + 7 * DAY).toISOString() });
    await prisma().subscription.deleteMany({});

    await subscribe('ACTIVE', new Date(NOW.getTime() - 20 * DAY));
    expect(await (await call(company.id, 'wholesale')).json()).toMatchObject({ status: 'EXPIRED', active: false });
  });

  it('is not active when cancelled, and a live renewal wins over an older cancelled one', async () => {
    await subscribe('CANCELLED', new Date(NOW.getTime() + 100 * DAY));
    expect(await (await call(company.id, 'wholesale')).json()).toMatchObject({ status: 'CANCELLED', active: false });
    await subscribe('ACTIVE', new Date(NOW.getTime() + 300 * DAY));
    expect(await (await call(company.id, 'wholesale')).json()).toMatchObject({ status: 'ACTIVE', active: true });
  });

  it('stamps lastUsedAt on the client', async () => {
    await call(company.id, 'wholesale');
    const client = await prisma().serviceClient.findFirstOrThrow();
    expect(client.lastUsedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('counts calls per client and answers 429 with retry-after once over the limit', async () => {
    const client = await prisma().serviceClient.findFirstOrThrow();
    await prisma().authRateLimit.create({ data: { key: `entitlements:client:${client.id}`, count: 600, windowStart: NOW } });
    const res = await call(company.id, 'wholesale');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('making and revoking a service client', () => {
  it('lets only the platform owner make one, returns its secret once, and keeps only the hash', async () => {
    const owner = await person('owner', true);
    const admin = await person('plain-admin', false);
    expect((await act(admin, wholesaleActions.createClient, { name: 'Wholesale' })).ok).toBe(false);

    const made = dataOf(await act(owner, wholesaleActions.createClient, { name: 'Wholesale server' }));
    expect(made.secret).toMatch(/^bzc_/);
    const stored = await prisma().serviceClient.findUniqueOrThrow({ where: { id: made.id } });
    expect(stored.applicationId).toBe('wholesale');
    expect(stored.secretHash).toBe(hashSecret(made.secret));
    expect(JSON.stringify(stored)).not.toContain(made.secret);

    const logged = JSON.stringify(await prisma().auditLog.findMany({ where: { action: 'wholesale.client_created' } }));
    expect(logged).toContain('Wholesale server');
    expect(logged).not.toContain(made.secret);
    expect((await call(company.id, 'wholesale', { authorization: `Bearer ${made.secret}` })).status).toBe(200);

    const listed = dataOf(await ask(owner, wholesaleQueries.wholesaleClients));
    expect(listed.clients.map((c) => c.name)).toContain('Wholesale server');
    expect(JSON.stringify(listed)).not.toContain('secretHash');
    expect((await ask(admin, wholesaleQueries.wholesaleClients)).ok).toBe(false);
  });

  it('revokes a client so its secret stops working, and refuses a stranger', async () => {
    const owner = await person('owner', true);
    const admin = await person('plain-admin', false);
    const made = dataOf(await act(owner, wholesaleActions.createClient, { name: 'Temp' }));
    expect((await act(admin, wholesaleActions.revokeClient, { id: made.id })).ok).toBe(false);
    dataOf(await act(owner, wholesaleActions.revokeClient, { id: made.id }));
    expect((await call(company.id, 'wholesale', { authorization: `Bearer ${made.secret}` })).status).toBe(401);
    dataOf(await act(owner, wholesaleActions.revokeClient, { id: made.id }));
    const missing = await act(owner, wholesaleActions.revokeClient, { id: 'nope' });
    expect(missing.ok ? 'OK' : missing.error.code).toBe('NOT_FOUND');
  });
});
