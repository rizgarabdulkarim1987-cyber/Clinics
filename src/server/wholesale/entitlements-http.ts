import type { PrismaClient } from '@/generated/prisma/client';
import { getPrisma } from '@/server/data/prisma';
import { clientIp } from '@/server/http/client-ip';
import { addressKey, checkRateLimit, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { authenticateClient, bearerSecret, entitlementsOf } from './service-client';

/**
 * `GET /api/v1/entitlements/{businessId}/{applicationId}` with `Authorization: Bearer bzc_...`: the contract a separate
 * product (Wholesale) already calls. 200 `Entitlements`; every refusal is `{ error: { code, message } }`:
 * 401 `UNAUTHENTICATED` (no or unknown or revoked secret; said alike), 403 `FORBIDDEN` (the secret belongs to another
 * application), 404 `NOT_FOUND` (not a business this application serves), 429 `RATE_LIMITED`, 503 `UNAVAILABLE`.
 * Calls are counted per address before the secret is looked up (so guessing is capped) and per client after.
 * Nothing is logged but an error's name, never a secret.
 */

const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const refusal = (status: number, code: string, message: string, extra: Record<string, string> = {}): Response =>
  Response.json({ error: { code, message } }, { status, headers: { ...HEADERS, ...extra } });

const limited = (retryAfterSec: number): Response => refusal(429, 'RATE_LIMITED', 'Too many requests', { 'retry-after': String(retryAfterSec) });

export async function entitlementsRoute(
  request: Request,
  businessId: string,
  applicationId: string,
  prisma: PrismaClient = getPrisma(),
  now: Date = new Date(),
): Promise<Response> {
  try {
    const ip = await checkRateLimit(prisma, `entitlements:ip:${addressKey(clientIp(request.headers))}`, RATE_RULES['entitlements:ip'], now);
    if (!ip.allowed) return limited(ip.retryAfterSec);

    const secret = bearerSecret(request.headers.get('authorization'));
    const client = secret ? await authenticateClient(prisma, secret, now) : null;
    if (!client) return refusal(401, 'UNAUTHENTICATED', 'A valid service secret is required');

    const own = await checkRateLimit(prisma, `entitlements:client:${client.id}`, RATE_RULES['entitlements:client'], now);
    if (!own.allowed) return limited(own.retryAfterSec);

    if (client.applicationId !== applicationId) return refusal(403, 'FORBIDDEN', 'This secret cannot read that application');

    const entitlements = await entitlementsOf(prisma, businessId, applicationId, now);
    if (!entitlements) return refusal(404, 'NOT_FOUND', 'No such business for this application');
    return Response.json(entitlements, { headers: HEADERS });
  } catch (error) {
    console.error(`[entitlements] ${error instanceof Error ? error.name : 'unknown error'}`);
    return refusal(503, 'UNAVAILABLE', 'Try again shortly');
  }
}
