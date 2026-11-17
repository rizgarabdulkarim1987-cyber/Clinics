import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ClSessionView } from './auth/sign-in';
import type { ClMembership } from './framework';

/** Where Clinics sends a person who is not signed in: its own sign-in, never the Studio's. */
export const CL_SIGN_IN = '/clinic/sign-in';

export type ClEntry =
  | { kind: 'signIn'; to: string }
  | { kind: 'noClinic' }
  | { kind: 'choose'; clinics: ClMembership[] }
  | { kind: 'closed'; reason: 'suspended' | 'archived'; member: ClMembership }
  | { kind: 'open'; member: ClMembership };

/**
 * What a clinic page does with the request, as data. A signed-in account with no clinic gets "no clinic", never a redirect
 * to sign-in, which would send them straight back and loop. One clinic opens by itself; two or more ask, unless the
 * person's chosen clinic is still one of theirs.
 */
export function clEntry(input: { session: ClSessionView | null; memberships: readonly ClMembership[]; chosen: string | null }): ClEntry {
  if (!input.session) return { kind: 'signIn', to: CL_SIGN_IN };
  const { memberships } = input;
  if (memberships.length === 0) return { kind: 'noClinic' };
  const current = memberships.length === 1 ? memberships[0] : memberships.find((m) => m.restaurantId === input.chosen);
  if (!current) return { kind: 'choose', clinics: [...memberships] };
  if (current.clinicStatus === 'SUSPENDED') return { kind: 'closed', reason: 'suspended', member: current };
  if (current.clinicStatus === 'ARCHIVED') return { kind: 'closed', reason: 'archived', member: current };
  return { kind: 'open', member: current };
}

/** The cookie that remembers which clinic the person chose. HttpOnly; its value is signed for one account. */
export const CL_PLACE_COOKIE = 'bz_cl_place';

const ID = /^[A-Za-z0-9_-]+$/;

const mac = (secret: string, accountId: string, restaurantId: string): string =>
  createHmac('sha256', secret).update(['cl-place', accountId, restaurantId].join('\n')).digest('base64url');

/** `clinic.signature`, signed for one account: a value copied to another account's browser is worth nothing. */
export const signClPlaceCookie = (secret: string, accountId: string, restaurantId: string): string => `${restaurantId}.${mac(secret, accountId, restaurantId)}`;

/** The clinic a cookie value names, when it is well formed and signed for `accountId`; null otherwise. The caller still checks it against what the account may use now. */
export function readClPlaceCookie(secret: string, accountId: string, value: string | undefined): string | null {
  const parts = value?.split('.') ?? [];
  if (parts.length !== 2) return null;
  const [restaurantId, given] = parts as [string, string];
  if (!ID.test(restaurantId) || given === '') return null;
  const expected = Buffer.from(mac(secret, accountId, restaurantId));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return restaurantId;
}
