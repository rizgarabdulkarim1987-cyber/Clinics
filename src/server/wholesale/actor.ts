import type { PrismaClient } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import { effectiveStatus, graceEndsAt, isLive } from '@/server/domain/billing/subscriptions';
import type { WhRole } from '@/server/domain/wholesale/permissions';

const DAY_MS = 86_400_000;

/** How long a lapsed company stays readable and exportable before it is archived. */
export const WH_RETENTION_DAYS = 90;

/** Who works in a wholesale company: a person, the one company they act in, their role and (a rep) his own warehouse. */
export interface WhActor {
  userId: string;
  name: string;
  restaurantId: string;
  restaurantName: string;
  role: WhRole;
  /** A rep's own warehouse; null for a partner (all warehouses). */
  warehouseId: string | null;
  /** True when the role comes from being the company's Studio OWNER rather than from a staff row. */
  viaMembership: boolean;
  locale: Locale;
}

export type WhGate =
  | { state: 'open' }
  | { state: 'readOnly'; until: Date }
  | { state: 'closed'; reason: 'restaurantInactive' | 'notWholesale' | 'planInactive' | 'applicationDisabled' | 'archived' };

/**
 * Whether a company may work at `now`: the restaurant is ACTIVE and a wholesale company, and its `wholesale` subscription is
 * live (open), or lapsed within the retention window (readOnly until its end), or lapsed longer ago (closed, archived).
 */
export async function whGate(prisma: PrismaClient, restaurantId: string, now: Date): Promise<WhGate> {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { status: true, sector: true } });
  if (!restaurant || restaurant.status !== 'ACTIVE') return { state: 'closed', reason: 'restaurantInactive' };
  if (restaurant.sector !== 'WHOLESALE') return { state: 'closed', reason: 'notWholesale' };
  const rows = await prisma.subscription.findMany({
    where: { restaurantId, applicationId: 'wholesale' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true, cancelledAt: true, application: { select: { status: true } } },
  });
  const subscription = rows.find((row) => isLive(effectiveStatus(row, now))) ?? rows[0];
  if (!subscription) return { state: 'closed', reason: 'planInactive' };
  if (subscription.application.status !== 'ACTIVE') return { state: 'closed', reason: 'applicationDisabled' };
  const status = effectiveStatus(subscription, now);
  if (isLive(status)) return { state: 'open' };
  const lapsedAt = status === 'CANCELLED' ? (subscription.cancelledAt ?? subscription.currentPeriodEnd) : graceEndsAt(subscription);
  const until = new Date(lapsedAt.getTime() + WH_RETENTION_DAYS * DAY_MS);
  return now.getTime() < until.getTime() ? { state: 'readOnly', until } : { state: 'closed', reason: 'archived' };
}

/**
 * The Wholesale identity of a user in one company. A Studio OWNER member of a WHOLESALE restaurant is its OWNER; anyone else
 * needs an active `WhStaff` row. A deactivated user has none. The answer is for the named company only.
 */
export async function resolveWhActor(prisma: PrismaClient, userId: string, restaurantId: string): Promise<WhActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      locale: true,
      deactivatedAt: true,
      memberships: { where: { restaurantId, role: 'OWNER' }, select: { id: true }, take: 1 },
      whStaffs: { where: { restaurantId, deactivatedAt: null }, select: { role: true, warehouseId: true }, take: 1 },
    },
  });
  if (!user || user.deactivatedAt) return null;
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true, sector: true } });
  if (!restaurant || restaurant.sector !== 'WHOLESALE') return null;
  const staff = user.whStaffs[0];
  const owner = user.memberships.length > 0;
  if (!owner && !staff) return null;
  return {
    userId: user.id,
    name: user.name,
    restaurantId,
    restaurantName: restaurant.name,
    role: owner ? 'OWNER' : staff!.role,
    warehouseId: owner ? null : (staff!.warehouseId ?? null),
    viaMembership: owner,
    locale: isLocale(user.locale) ? user.locale : 'en',
  };
}
