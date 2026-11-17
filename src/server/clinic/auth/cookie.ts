import { cookies } from 'next/headers';
import { getPrisma } from '@/server/data/prisma';
import { requestSpace } from '../request-space';
import { spaceBase, type ClSpace } from '../space';
import { readClSession, signOutClinic, type ClSessionView } from './sign-in';

/** The clinic session's cookie. Its own name, host-only (no Domain), so no other product's cookie is ever read as it. */
export const CL_SESSION_COOKIE = 'bz_cl_session';
/** The beauty centre's, on its own path: a clinic login and a beauty login can sit in one browser and never meet. */
export const BT_SESSION_COOKIE = 'bz_bt_session';

export const sessionCookieName = (space: ClSpace): string => (space === 'BEAUTY' ? BT_SESSION_COOKIE : CL_SESSION_COOKIE);

/** HttpOnly, Lax, sent to the product's own pages only, Secure everywhere but development and test. */
export function clCookieOptions(expires: Date, env: Record<string, string | undefined> = process.env, space: ClSpace = 'CLINIC') {
  const devLike = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  return { httpOnly: true, sameSite: 'lax' as const, path: spaceBase(space), expires, secure: !devLike };
}

export async function setClSessionCookie(token: string, expires: Date, space?: ClSpace): Promise<void> {
  const own = space ?? (await requestSpace());
  (await cookies()).set(sessionCookieName(own), token, clCookieOptions(expires, process.env, own));
}

export async function clearClSessionCookie(): Promise<void> {
  const space = await requestSpace();
  const jar = await cookies();
  await signOutClinic(getPrisma(), jar.get(sessionCookieName(space))?.value);
  jar.set(sessionCookieName(space), '', { ...clCookieOptions(new Date(0), process.env, space), maxAge: 0 });
}

/** The session of the current request, for the product its path belongs to, or null. A session of the other product is never read. */
export async function currentClSession(): Promise<ClSessionView | null> {
  const space = await requestSpace();
  const session = await readClSession(getPrisma(), (await cookies()).get(sessionCookieName(space))?.value);
  return session && session.space === space ? session : null;
}
