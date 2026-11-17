import type { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { productRuns } from '@/server/domain/billing/subscriptions';
import { restaurantDb, type RestaurantDb } from '@/server/data/tenant-db';
import { expectedFailure, failure, invalidInput, type ActionResult } from '@/server/studio/framework/result';
import type { ClSessionView } from './auth/sign-in';
import type { ClSpace } from './space';

/**
 * Clinics' own small action framework. It does not use the Studio's: that one is built on Studio users and the
 * Studio's permissions, and nothing of the Studio may decide who works in a clinic. An action here names the roles that
 * may run it; the server checks the role (the menu hiding a link is only a courtesy), the clinic is always one the
 * signed-in account belongs to, and the database client the action receives is confined to that clinic.
 */

export type ClRole = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

/** One account's active place in one clinic. */
export interface ClMembership {
  memberId: string;
  restaurantId: string;
  clinicName: string;
  clinicStatus: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  /** The clinic's own plan has run out, grace days included. A business that never had a plan keeps running. */
  planEnded: boolean;
  role: ClRole;
  /** Empty means every branch. */
  branchIds: string[];
}

/** Every clinic the account works in: active memberships only, in businesses that are clinics. */
export async function loadClMemberships(prisma: PrismaClient, accountId: string, space: ClSpace = 'CLINIC', now: Date = new Date()): Promise<ClMembership[]> {
  // A business with no settings row is a clinic; only a beauty centre says so. An account sees the businesses of its own space.
  const ownKind = space === 'BEAUTY' ? { clSettings: { kind: 'BEAUTY' as const } } : { NOT: { clSettings: { kind: 'BEAUTY' as const } } };
  const rows = await prisma.clMember.findMany({
    where: { accountId, status: 'ACTIVE', restaurant: { sector: 'CLINIC', ...ownKind } },
    include: {
      restaurant: {
        select: {
          name: true,
          status: true,
          subscriptions: { where: { applicationId: 'clinic' }, select: { status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    memberId: row.id,
    restaurantId: row.restaurantId,
    clinicName: row.restaurant.name,
    clinicStatus: row.restaurant.status,
    planEnded: !productRuns(row.restaurant.subscriptions, now),
    role: row.role,
    branchIds: row.branchIds,
  }));
}

export interface ClAuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  /** `{ field: { before, after } }`. Never a request body, a password or a token. */
  changes: Record<string, { before: unknown; after: unknown }>;
}

/** What an action receives. `db` can only see and change the clinic `restaurantId`. */
export interface ClContext {
  db: RestaurantDb;
  restaurantId: string;
  member: ClMembership;
  account: ClSessionView;
  /** Queues an audit row; it is written, with the account, the clinic and the request, after the action succeeds. */
  audit(entry: ClAuditEntry): void;
}

export interface ClActionDef<I, O> {
  readonly kind: 'cl';
  readonly name: string;
  readonly roles: readonly ClRole[];
  readonly input: z.ZodType<I>;
  readonly run: (ctx: ClContext, input: I) => Promise<O>;
}

export function defineClAction<I, O>(def: { name: string; roles: readonly ClRole[]; input: z.ZodType<I>; run: (ctx: ClContext, input: NoInfer<I>) => Promise<O> }): ClActionDef<I, O> {
  if (def.roles.length === 0) throw new Error(`${def.name} lists no role: nobody could run it`);
  return { kind: 'cl', ...def };
}

export interface ClRunOptions {
  /** The clinic the person works in now. May be left out when they work in exactly one. */
  restaurantId?: string;
}

export interface ClRequestMeta {
  ip?: string;
  userAgent?: string;
}

/**
 * Runs an action for a clinic account. Order of refusals: not signed in, no such clinic for this account (another
 * clinic's id answers exactly as an id that does not exist), a clinic that is not active, a role the action does not
 * list, input that does not fit. Anything unexpected is thrown, after nothing has been written to the audit log.
 */
export async function runClAction<I, O>(
  prisma: PrismaClient,
  session: ClSessionView | null,
  def: ClActionDef<I, O>,
  raw: unknown,
  options: ClRunOptions = {},
  meta: ClRequestMeta = {},
  now: Date = new Date(),
): Promise<ActionResult<O>> {
  if (!session) return failure('UNAUTHENTICATED');
  const memberships = await loadClMemberships(prisma, session.accountId, session.space, now);
  let member: ClMembership | undefined;
  if (options.restaurantId !== undefined) member = memberships.find((m) => m.restaurantId === options.restaurantId);
  else if (memberships.length === 1) member = memberships[0];
  else if (memberships.length > 1) return failure('INVALID', 'Choose a clinic');
  if (!member) return failure('NOT_FOUND');
  if (member.clinicStatus !== 'ACTIVE') return failure('FORBIDDEN', 'This clinic is not active');
  if (member.planEnded) return failure('FORBIDDEN', 'This clinic’s plan has ended');
  if (!def.roles.includes(member.role)) return failure('FORBIDDEN');

  const parsed = def.input.safeParse(raw);
  if (!parsed.success) return invalidInput(parsed.error);

  const audits: ClAuditEntry[] = [];
  const ctx: ClContext = { db: restaurantDb(prisma, member.restaurantId), restaurantId: member.restaurantId, member, account: session, audit: (entry) => void audits.push(entry) };
  try {
    const data = await def.run(ctx, parsed.data);
    if (audits.length > 0) {
      await prisma.auditLog.createMany({
        data: audits.map((entry) => ({
          actorId: session.accountId,
          restaurantId: member.restaurantId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          changes: entry.changes as Prisma.InputJsonValue,
          ip: (meta.ip ?? '').slice(0, 64),
          userAgent: (meta.userAgent ?? '').slice(0, 256),
        })),
      });
    }
    return { ok: true, data };
  } catch (error) {
    const expected = expectedFailure(error);
    if (expected) return expected;
    throw error;
  }
}
