import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { effectiveStatus, graceEndsAt, isLive, type SubscriptionStatus } from '@/server/domain/billing/subscriptions';

/**
 * A separate product's key to Core (`ServiceClient`): it asks one question, "is this business's subscription to my
 * application live?", and reads nothing else. The secret is `bzc_` + 32 random bytes; only its SHA-256 is stored (the
 * secret is already random, so a plain hash is enough), and it is shown once, when the client is made.
 */

export const SECRET_PREFIX = 'bzc_';

export const newSecret = (): string => `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
export const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

/** The secret in an `Authorization: Bearer <secret>` header, or null when the header is absent or not shaped like one. */
export function bearerSecret(header: string | null): string | null {
  const match = /^Bearer (bzc_[A-Za-z0-9_-]{20,100})$/.exec(header ?? '');
  return match ? (match[1] as string) : null;
}

export type AuthenticatedClient = { id: string; applicationId: string };

/** How long `lastUsedAt` is left alone, so a busy client does not write a row on every request. */
const TOUCH_AFTER_MS = 60_000;

/** The live (not revoked) client holding this secret, or null. */
export async function authenticateClient(prisma: Pick<PrismaClient, 'serviceClient'>, secret: string, now: Date): Promise<AuthenticatedClient | null> {
  const client = await prisma.serviceClient.findUnique({
    where: { secretHash: hashSecret(secret) },
    select: { id: true, applicationId: true, revokedAt: true, lastUsedAt: true },
  });
  if (!client || client.revokedAt) return null;
  if (!client.lastUsedAt || now.getTime() - client.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
    await prisma.serviceClient.update({ where: { id: client.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }
  return { id: client.id, applicationId: client.applicationId };
}

export type EntitlementStatus = SubscriptionStatus | 'NONE';

export type Entitlements = {
  businessId: string;
  applicationId: string;
  status: EntitlementStatus;
  active: boolean;
  plan: string | null;
  features: string[];
  limits: Record<string, never>;
  validUntil: string | null;
  graceEndsAt: string | null;
  checkedAt: string;
};

/**
 * What `GET /api/v1/entitlements/{businessId}/{applicationId}` answers: the business's subscription to the application as
 * it is now (the live one, else the newest). `active` is true for a trial, an active subscription and the grace days,
 * like the product gate (`productRuns`); with no subscription it is false (`NONE`), because a separate product starts
 * read-only until a subscription exists. null when the business is not one the application serves (unknown id, or not a
 * WHOLESALE company with a link): the caller learns nothing about other businesses.
 */
export async function entitlementsOf(
  prisma: Pick<PrismaClient, 'restaurant' | 'subscription'>,
  businessId: string,
  applicationId: string,
  now: Date,
): Promise<Entitlements | null> {
  const sector = ENTITLED_SECTOR[applicationId];
  if (!sector) return null;
  const business = await prisma.restaurant.findFirst({
    where: { id: businessId, sector, ...(sector === 'WHOLESALE' ? { wholesaleLink: { isNot: null } } : {}) },
    select: { id: true },
  });
  if (!business) return null;
  const subs = await prisma.subscription.findMany({
    where: { restaurantId: businessId, applicationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { planCode: true, status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true },
  });
  const own = subs.map((sub) => ({ sub, status: effectiveStatus(sub, now) }));
  const current = own.find(({ status }) => isLive(status)) ?? own[0];
  const base = { businessId, applicationId, features: [], limits: {}, checkedAt: now.toISOString() };
  if (!current) return { ...base, status: 'NONE', active: false, plan: null, validUntil: null, graceEndsAt: null };
  const { sub, status } = current;
  const validUntil = status === 'TRIAL' && sub.trialEndsAt ? sub.trialEndsAt : sub.currentPeriodEnd;
  return {
    ...base,
    status,
    active: isLive(status),
    plan: sub.planCode,
    validUntil: validUntil.toISOString(),
    graceEndsAt: status === 'TRIAL' ? null : graceEndsAt(sub).toISOString(),
  };
}

/** The applications that can be asked about, and the sector of the businesses that hold them. */
const ENTITLED_SECTOR: Record<string, 'WHOLESALE' | undefined> = { wholesale: 'WHOLESALE' };
