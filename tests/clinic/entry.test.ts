import { describe, expect, it } from 'vitest';
import { clEntry, readClPlaceCookie, signClPlaceCookie, CL_SIGN_IN } from '@/server/clinic/entry';
import type { ClSessionView } from '@/server/clinic/auth/sign-in';
import type { ClMembership } from '@/server/clinic/framework';

/** What a clinic page does with a request, as data; and the signed cookie that remembers the clinic a person chose. */

const session: ClSessionView = { sessionId: 's', accountId: 'acc1', name: 'Sara', email: 'sara@example.com', space: 'CLINIC' };
const member = (restaurantId: string, extra: Partial<ClMembership> = {}): ClMembership => ({
  memberId: `m-${restaurantId}`,
  restaurantId,
  clinicName: restaurantId,
  clinicStatus: 'ACTIVE',
  role: 'DOCTOR',
  branchIds: [],
  ...extra,
});

describe('clEntry', () => {
  it('sends nobody signed in to the clinic sign-in, never to the Studio’s', () => {
    expect(clEntry({ session: null, memberships: [], chosen: null })).toEqual({ kind: 'signIn', to: CL_SIGN_IN });
    expect(CL_SIGN_IN).toBe('/clinic/sign-in');
  });

  it('says "no clinic" for a signed-in account with none, instead of looping back to sign-in', () => {
    expect(clEntry({ session, memberships: [], chosen: null })).toEqual({ kind: 'noClinic' });
  });

  it('opens the only clinic without asking, and asks when there are two', () => {
    expect(clEntry({ session, memberships: [member('a')], chosen: null })).toEqual({ kind: 'open', member: member('a') });
    expect(clEntry({ session, memberships: [member('a'), member('b')], chosen: null })).toEqual({ kind: 'choose', clinics: [member('a'), member('b')] });
  });

  it('opens the chosen clinic when it is still one of theirs, and asks again when it is not', () => {
    expect(clEntry({ session, memberships: [member('a'), member('b')], chosen: 'b' })).toEqual({ kind: 'open', member: member('b') });
    expect(clEntry({ session, memberships: [member('a'), member('b')], chosen: 'gone' })).toMatchObject({ kind: 'choose' });
  });

  it('closes a clinic that is suspended or archived, with the reason', () => {
    expect(clEntry({ session, memberships: [member('a', { clinicStatus: 'SUSPENDED' })], chosen: null })).toMatchObject({ kind: 'closed', reason: 'suspended' });
    expect(clEntry({ session, memberships: [member('a', { clinicStatus: 'ARCHIVED' })], chosen: null })).toMatchObject({ kind: 'closed', reason: 'archived' });
  });
});

describe('the chosen-clinic cookie', () => {
  const secret = 'a-long-test-secret-for-the-clinic-cookie';

  it('reads back what was signed for the same account', () => {
    expect(readClPlaceCookie(secret, 'acc1', signClPlaceCookie(secret, 'acc1', 'clinic-a'))).toBe('clinic-a');
  });

  it('is worth nothing in another account’s browser, with another secret, or when altered', () => {
    const value = signClPlaceCookie(secret, 'acc1', 'clinic-a');
    expect(readClPlaceCookie(secret, 'acc2', value)).toBeNull();
    expect(readClPlaceCookie('another-secret-another-secret-123', 'acc1', value)).toBeNull();
    expect(readClPlaceCookie(secret, 'acc1', value.replace('clinic-a', 'clinic-b'))).toBeNull();
    expect(readClPlaceCookie(secret, 'acc1', undefined)).toBeNull();
    expect(readClPlaceCookie(secret, 'acc1', 'garbage')).toBeNull();
  });
});
