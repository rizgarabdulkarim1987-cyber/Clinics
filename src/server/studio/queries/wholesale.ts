import { z } from 'zod';
import { effectiveStatus, isLive } from '@/server/domain/billing/subscriptions';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { effectiveAdminUrl } from '@/server/wholesale/link';

type Names = { en: string; ar: string; ckb: string };

/**
 * Every WHOLESALE-sector company that has a `WholesaleLink`, for the Wholesale space's list: status, its `wholesale`
 * subscription as it is now (the live one, else the newest) and whether the address of its own system is set. `unlinkedOnly`
 * keeps the companies with no address yet. `platform.settings`, like the Retail and Pharmacy lists: no tenant reads it.
 */
export const wholesaleList = defineQuery({
  name: 'wholesale.list',
  permission: 'platform.settings',
  input: z.object({ unlinkedOnly: z.boolean().optional() }),
  target: () => ({ kind: 'platform' }) as const,
  run: async (ctx, { unlinkedOnly }) => {
    const now = new Date();
    const [companies, plans] = await Promise.all([
      ctx.db.restaurant.findMany({
        where: { sector: 'WHOLESALE', wholesaleLink: { isNot: null } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          wholesaleLink: { select: { adminUrl: true } },
          subscriptions: {
            where: { applicationId: 'wholesale' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { planCode: true, status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true, anchorDay: true },
          },
        },
      }),
      ctx.db.appPlan.findMany({ where: { applicationId: 'wholesale' }, select: { code: true, name: true } }),
    ]);
    const planName = new Map(plans.map((plan) => [plan.code, plan.name as Names]));

    const rows = companies.map((company) => {
      const own = company.subscriptions.map((sub) => ({ sub, status: effectiveStatus(sub, now) }));
      const current = own.find(({ status }) => isLive(status)) ?? own[0];
      return {
        id: company.id,
        name: company.name,
        status: company.status,
        createdAt: company.createdAt,
        hasAddress: company.wholesaleLink!.adminUrl !== null,
        subscription: current
          ? {
              status: current.status,
              planCode: current.sub.planCode,
              planName: planName.get(current.sub.planCode) ?? null,
              currentPeriodEnd: current.sub.currentPeriodEnd,
              trial: current.sub.anchorDay === null && current.sub.trialEndsAt !== null,
            }
          : null,
      };
    });
    return { rows: unlinkedOnly ? rows.filter((row) => !row.hasAddress) : rows };
  },
});

function restaurantOf(ctx: QueryContext): string {
  if (ctx.restaurantId === null) throw new Error('A wholesale query ran without a restaurant');
  return ctx.restaurantId;
}

/**
 * One company's Wholesale tab: the address of its own system and the ids Core knows it by. Core's business id is the
 * company's id here, and its application id is `wholesale`: the person who installs the company's system (add-company)
 * passes them on. Nothing secret is read.
 */
export const wholesaleDetail = defineQuery({
  name: 'wholesale.detail',
  permission: 'platform.settings',
  input: z.object({ restaurantId: z.string().min(1).max(100) }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }) as const,
  run: async (ctx) => {
    const restaurantId = restaurantOf(ctx);
    const company = await ctx.db.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true, name: true, sector: true, wholesaleLink: true } });
    if (!company || company.sector !== 'WHOLESALE' || !company.wholesaleLink) throw new StudioError('NOT_FOUND');
    return { id: company.id, name: company.name, adminUrl: effectiveAdminUrl(company.wholesaleLink.adminUrl), coreBusinessId: company.id, coreApplicationId: 'wholesale' };
  },
});

/** The service clients of the Wholesale application, newest first: never the secret, which is not kept. The platform owner only. */
export const wholesaleClients = defineQuery({
  name: 'wholesale.clients',
  permission: 'plans.manage',
  input: z.object({}),
  target: () => ({ kind: 'platform' }) as const,
  run: async (ctx) => ({
    clients: await ctx.db.serviceClient.findMany({
      where: { applicationId: 'wholesale' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    }),
  }),
});
