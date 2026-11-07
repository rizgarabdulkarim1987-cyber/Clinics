import { cache } from 'react';
import { getPrisma } from '@/server/data/prisma';
import { getActor } from '@/server/studio/auth/actor';
import { invoke, invokeQuery, query } from '@/server/studio/framework/invoke';
import type { ActionDef } from '@/server/studio/framework/action';
import type { QueryDef } from '@/server/studio/framework/query';
import { failure, type ActionResult } from '@/server/studio/framework/result';
import { resolveWhActor, whGate, type WhActor, type WhGate } from './actor';

/** Where a person who is not signed in is sent: the Studio's sign-in, which returns here (one sign-in for every area). */
export const WH_SIGN_IN = '/studio/sign-in?next=/wholesale';

export interface WhAccess {
  signedIn: boolean;
  actor: WhActor | null;
  gate: WhGate | null;
}

/**
 * The person's wholesale company for this request: the company they own in the Studio, or work in through a staff row (the
 * earliest of them when they have several). The company never comes from the browser. Cached for the request.
 */
export const getWhAccess = cache(async (): Promise<WhAccess> => {
  const actor = await getActor();
  if (!actor) return { signedIn: false, actor: null, gate: null };
  const prisma = getPrisma();
  const [owned, staffed] = await Promise.all([
    prisma.membership.findMany({
      where: { userId: actor.userId, role: 'OWNER', restaurant: { sector: 'WHOLESALE' } },
      select: { restaurantId: true, createdAt: true },
    }),
    prisma.whStaff.findMany({ where: { userId: actor.userId, deactivatedAt: null }, select: { restaurantId: true, createdAt: true } }),
  ]);
  const candidates = [...owned, ...staffed].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const { restaurantId } of candidates) {
    const who = await resolveWhActor(prisma, actor.userId, restaurantId);
    if (!who) continue;
    return { signedIn: true, actor: who, gate: await whGate(prisma, restaurantId, new Date()) };
  }
  return { signedIn: true, actor: null, gate: null };
});

const withCompany = (raw: unknown, restaurantId: string) => ({ ...((raw ?? {}) as Record<string, unknown>), restaurantId });

/** Runs a Wholesale action for the current request in the person's own company; refused before the framework without one. */
export async function invokeWh<I, O>(def: ActionDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  const { actor } = await getWhAccess();
  if (!actor) return failure('FORBIDDEN');
  return invoke(def, withCompany(raw, actor.restaurantId));
}

/** A Wholesale read for a client component's Server Action. */
export async function invokeWhQuery<I, O>(def: QueryDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  const { actor } = await getWhAccess();
  if (!actor) return failure('FORBIDDEN');
  return invokeQuery(def, withCompany(raw, actor.restaurantId));
}

/** A Wholesale read for a page: refusals become what a page shows (sign-in, the 404 page). */
export async function queryWh<I, O>(def: QueryDef<I, O>, raw: unknown = {}): Promise<O> {
  const { actor } = await getWhAccess();
  if (!actor) throw new Error('A wholesale page read ran without a company');
  return query(def, withCompany(raw, actor.restaurantId));
}
