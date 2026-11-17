import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getPrisma } from '@/server/data/prisma';
import { authEnv } from '@/server/env';
import { clientIp } from '@/server/http/client-ip';
import type { ActionResult } from '@/server/studio/framework/result';
import { CL_SESSION_COOKIE, clCookieOptions, currentClSession } from './auth/cookie';
import type { ClSessionView } from './auth/sign-in';
import { CL_PLACE_COOKIE, CL_SIGN_IN, clEntry, readClPlaceCookie, signClPlaceCookie, type ClEntry } from './entry';
import { loadClMemberships, runClAction, type ClActionDef, type ClMembership } from './framework';
import { canSee, type ClScreen } from './roles';

/**
 * What a clinic request knows about the person: their clinic session, their clinics and the one they chose. Cached per
 * request, so a layout and its page share one lookup. Nothing here reads a Studio session.
 */
export const getClAccess = cache(async (): Promise<{ session: ClSessionView | null; memberships: ClMembership[]; entry: ClEntry }> => {
  const session = await currentClSession();
  const memberships = session ? await loadClMemberships(getPrisma(), session.accountId) : [];
  const chosen = session ? readClPlaceCookie(authEnv().secret, session.accountId, (await cookies()).get(CL_PLACE_COOKIE)?.value) : null;
  return { session, memberships, entry: clEntry({ session, memberships, chosen }) };
});

/** The clinic and role a signed-in request works in, for a page of `screen`: sign-in, "not found", the chooser or a closed notice are redirects; a role that may not see the screen is "not found". */
export async function requireClScreen(screen: ClScreen): Promise<{ session: ClSessionView; member: ClMembership; memberships: ClMembership[] }> {
  const { session, memberships, entry } = await getClAccess();
  switch (entry.kind) {
    case 'signIn':
      redirect(CL_SIGN_IN);
     
    case 'noClinic':
      notFound();
     
    case 'choose':
      redirect('/clinic/select');
     
    case 'closed':
      redirect('/clinic/closed');
     
    case 'open':
      if (!canSee(entry.member.role, screen)) notFound();
      return { session: session!, member: entry.member, memberships };
  }
}

/** Remembers the clinic a person chose, if it is one of theirs. */
export async function chooseClinic(restaurantId: string): Promise<boolean> {
  const session = await currentClSession();
  if (!session) return false;
  const memberships = await loadClMemberships(getPrisma(), session.accountId);
  if (!memberships.some((m) => m.restaurantId === restaurantId)) return false;
  const value = signClPlaceCookie(authEnv().secret, session.accountId, restaurantId);
  (await cookies()).set(CL_PLACE_COOKIE, value, { ...clCookieOptions(new Date(Date.now() + 400 * 86_400_000)) });
  return true;
}

/** Runs a clinic action for the current request: its session, the clinic it chose, its address and browser. Each Server Action is a one-line call to this. */
export async function invokeCl<I, O>(def: ClActionDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  const [{ session, entry }, requestHeaders] = await Promise.all([getClAccess(), headers()]);
  const restaurantId = entry.kind === 'open' ? entry.member.restaurantId : undefined;
  return runClAction(getPrisma(), session, def, raw, restaurantId ? { restaurantId } : {}, {
    ip: clientIp(requestHeaders),
    userAgent: requestHeaders.get('user-agent') ?? '',
  });
}

export { CL_SESSION_COOKIE };
