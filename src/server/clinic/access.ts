import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getPrisma } from '@/server/data/prisma';
import { authEnv } from '@/server/env';
import { clientIp } from '@/server/http/client-ip';
import type { ActionResult } from '@/server/studio/framework/result';
import { CL_SESSION_COOKIE, clCookieOptions, currentClSession } from './auth/cookie';
import type { ClSessionView } from './auth/sign-in';
import { clEntry, placeCookieName, readClPlaceCookie, signClPlaceCookie, type ClEntry } from './entry';
import { loadClMemberships, runClAction, type ClActionDef, type ClMembership } from './framework';
import { requestSpace } from './request-space';
import { canSee, type ClScreen } from './roles';
import { spaceBase, type ClSpace } from './space';

/**
 * What a clinic or beauty request knows about the person: their session, their businesses and the one they chose. Cached
 * per request, so a layout and its page share one lookup. Nothing here reads a Studio session, and a login of the other
 * product is never read: the path the request is for says which product it is.
 */
export const getClAccess = cache(async (): Promise<{ space: ClSpace; session: ClSessionView | null; memberships: ClMembership[]; entry: ClEntry }> => {
  const space = await requestSpace();
  const session = await currentClSession();
  const memberships = session ? await loadClMemberships(getPrisma(), session.accountId, space) : [];
  const chosen = session ? readClPlaceCookie(authEnv().secret, session.accountId, (await cookies()).get(placeCookieName(space))?.value) : null;
  return { space, session, memberships, entry: clEntry({ session, memberships, chosen, space }) };
});

/** The business and role a signed-in request works in, for a page of `screen`: sign-in, "not found", the chooser or a closed notice are redirects; a role that may not see the screen is "not found". */
export async function requireClScreen(screen: ClScreen): Promise<{ session: ClSessionView; member: ClMembership; memberships: ClMembership[]; space: ClSpace }> {
  const { space, session, memberships, entry } = await getClAccess();
  const base = spaceBase(space);
  switch (entry.kind) {
    case 'signIn':
      redirect(entry.to);

    case 'noClinic':
      notFound();

    case 'choose':
      redirect(`${base}/select`);

    case 'closed':
      redirect(`${base}/closed`);

    case 'open':
      if (!canSee(entry.member.role, screen)) notFound();
      return { session: session!, member: entry.member, memberships, space };
  }
}

/** Remembers the business a person chose, if it is one of theirs. */
export async function chooseClinic(restaurantId: string): Promise<{ ok: boolean; space: ClSpace }> {
  const space = await requestSpace();
  const session = await currentClSession();
  if (!session) return { ok: false, space };
  const memberships = await loadClMemberships(getPrisma(), session.accountId, space);
  if (!memberships.some((m) => m.restaurantId === restaurantId)) return { ok: false, space };
  const value = signClPlaceCookie(authEnv().secret, session.accountId, restaurantId);
  (await cookies()).set(placeCookieName(space), value, { ...clCookieOptions(new Date(Date.now() + 400 * 86_400_000), process.env, space) });
  return { ok: true, space };
}

/** Runs an action for the current request: its session, the business it chose, its address and browser. Each Server Action is a one-line call to this. */
export async function invokeCl<I, O>(def: ClActionDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  const [{ session, entry }, requestHeaders] = await Promise.all([getClAccess(), headers()]);
  const restaurantId = entry.kind === 'open' ? entry.member.restaurantId : undefined;
  return runClAction(getPrisma(), session, def, raw, restaurantId ? { restaurantId } : {}, {
    ip: clientIp(requestHeaders),
    userAgent: requestHeaders.get('user-agent') ?? '',
  });
}

export { CL_SESSION_COOKIE };
