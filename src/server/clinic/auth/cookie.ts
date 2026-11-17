import { cookies } from 'next/headers';
import { getPrisma } from '@/server/data/prisma';
import { readClSession, signOutClinic, type ClSessionView } from './sign-in';

/** The clinic session's cookie. Its own name, host-only (no Domain), so no other product's cookie is ever read as it. */
export const CL_SESSION_COOKIE = 'bz_cl_session';

/** HttpOnly, Lax, sent to the clinic app only, Secure everywhere but development and test. */
export function clCookieOptions(expires: Date, env: Record<string, string | undefined> = process.env) {
  const devLike = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  return { httpOnly: true, sameSite: 'lax' as const, path: '/clinic', expires, secure: !devLike };
}

export async function setClSessionCookie(token: string, expires: Date): Promise<void> {
  (await cookies()).set(CL_SESSION_COOKIE, token, clCookieOptions(expires));
}

export async function clearClSessionCookie(): Promise<void> {
  const jar = await cookies();
  await signOutClinic(getPrisma(), jar.get(CL_SESSION_COOKIE)?.value);
  jar.set(CL_SESSION_COOKIE, '', { ...clCookieOptions(new Date(0)), maxAge: 0 });
}

/** The clinic session of the current request, or null. Never reads a Studio session. */
export async function currentClSession(): Promise<ClSessionView | null> {
  return readClSession(getPrisma(), (await cookies()).get(CL_SESSION_COOKIE)?.value);
}
