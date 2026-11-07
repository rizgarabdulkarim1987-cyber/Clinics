import { z } from 'zod';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { ADMIN_URL_MAX, normalizeAdminUrl } from '@/server/wholesale/link';
import { hashSecret, newSecret } from '@/server/wholesale/service-client';

/**
 * A wholesale company's own Wholesale system, on the Studio side. Wholesale is one separate copy per company; Studio keeps
 * only its https address (`WholesaleLink.adminUrl`), for the Super Admin's "Open Wholesale". Any Super Admin
 * (`platform.settings`) sets it. A business without a `WholesaleLink` is not a wholesale company: not found.
 */

const atRestaurant = (restaurantId: string) => ({ kind: 'restaurant', restaurantId }) as const;

function restaurantOf(ctx: ActionContext): string {
  if (ctx.restaurantId === null) throw new Error('A wholesale action ran without a restaurant');
  return ctx.restaurantId;
}

export const setLink = defineAction({
  name: 'wholesale.setLink',
  permission: 'platform.settings',
  input: z.object({ restaurantId: z.string().min(1).max(100), adminUrl: z.string().max(ADMIN_URL_MAX, 'Use at most 300 characters') }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, { adminUrl }) =>
    ctx.transaction(async (tx) => {
      const restaurantId = restaurantOf(ctx);
      const next = normalizeAdminUrl(adminUrl);
      if (next === undefined) {
        throw new StudioError('INVALID', 'Check the highlighted fields', { adminUrl: 'Enter an address that starts with https:// and has a domain' });
      }
      const link = await tx.wholesaleLink.findUnique({ where: { restaurantId }, select: { adminUrl: true } });
      if (!link) throw new StudioError('NOT_FOUND');
      if (link.adminUrl === next) return { adminUrl: next };
      await tx.wholesaleLink.update({ where: { restaurantId }, data: { adminUrl: next } });
      ctx.audit({
        action: 'wholesale.link_changed',
        entityType: 'WholesaleLink',
        entityId: restaurantId,
        changes: { adminUrl: { before: link.adminUrl, after: next } },
      });
      return { adminUrl: next };
    }),
});

/**
 * The key Wholesale uses to ask Core whether a company's subscription is live (`GET /api/v1/entitlements/...`, see
 * src/server/wholesale/service-client.ts). Only the platform owner (`plans.manage`) makes or revokes one. The secret is
 * returned once, here, and never stored or audited: only its hash is kept.
 */
const PLATFORM = { kind: 'platform' } as const;
const APPLICATION = 'wholesale';

export const createClient = defineAction({
  name: 'wholesale.createClient',
  permission: 'plans.manage',
  input: z.object({ name: z.string().trim().min(1, 'Enter a name').max(80, 'Use at most 80 characters') }),
  target: () => PLATFORM,
  run: (ctx, { name }) =>
    ctx.transaction(async (tx) => {
      const secret = newSecret();
      const created = await tx.serviceClient.create({ data: { applicationId: APPLICATION, name, secretHash: hashSecret(secret) }, select: { id: true } });
      ctx.audit({
        action: 'wholesale.client_created',
        entityType: 'ServiceClient',
        entityId: created.id,
        changes: { name: { before: null, after: name } },
      });
      return { id: created.id, secret };
    }),
});

export const revokeClient = defineAction({
  name: 'wholesale.revokeClient',
  permission: 'plans.manage',
  input: z.object({ id: z.string().min(1).max(100) }),
  target: () => PLATFORM,
  run: (ctx, { id }) =>
    ctx.transaction(async (tx) => {
      const client = await tx.serviceClient.findFirst({ where: { id, applicationId: APPLICATION }, select: { name: true, revokedAt: true } });
      if (!client) throw new StudioError('NOT_FOUND');
      if (client.revokedAt) return { id };
      await tx.serviceClient.update({ where: { id }, data: { revokedAt: new Date() } });
      ctx.audit({ action: 'wholesale.client_revoked', entityType: 'ServiceClient', entityId: id, changes: { name: { before: client.name, after: client.name } } });
      return { id };
    }),
});
