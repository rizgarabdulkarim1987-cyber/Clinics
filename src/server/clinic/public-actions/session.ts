import { z } from 'zod';
import { setClSessionCookie, clearClSessionCookie } from '@/server/clinic/auth/cookie';
import { normalizeClEmail, signInClinic } from '@/server/clinic/auth/sign-in';
import { acceptClInvitation } from '@/server/clinic/invitations';
import { checkPasswordPolicy, passwordProblemMessage } from '@/server/studio/auth/password-policy';
import { addressKey, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { definePublicAction } from '@/server/studio/framework/public';
import { StudioError } from '@/server/studio/framework/result';

/** The clinic app's home: where a person lands once signed in. */
export const CLINIC_HOME = '/clinic/home';

/** The one answer to a failed sign-in or a locked account: it must not say which of the two, or which field, was wrong. */
const SIGN_IN_FAILED = 'Wrong email or password';

export const clinicSignIn = definePublicAction({
  name: 'clinic.signIn',
  input: z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(1024) }),
  // The Studio's limits, counted under the clinic's own keys: nothing is shared with a Studio sign-in.
  rateLimit: (input, { ip }) => [
    { key: `clsignin:ip:${addressKey(ip)}`, rule: RATE_RULES['signin:ip'] },
    { key: `clsignin:email:${normalizeClEmail(input.email)}`, rule: RATE_RULES['signin:email'] },
  ],
  run: async ({ prisma }, { email, password }) => {
    const result = await signInClinic(prisma, { email, password });
    if (!result.ok) throw new StudioError('INVALID', SIGN_IN_FAILED);
    await setClSessionCookie(result.token, result.expiresAt);
    return { next: CLINIC_HOME };
  },
});

const INVITATION_REFUSALS = {
  expired: 'This invitation has expired. Ask for a new one',
  used: 'This invitation was already used',
  revoked: 'This invitation is no longer valid',
  unknown: 'This invitation link is not valid',
} as const;

export const clinicAcceptInvitation = definePublicAction({
  name: 'clinic.acceptInvitation',
  input: z.object({ token: z.string().min(1).max(200), name: z.string().trim().max(120), password: z.string().min(1).max(1024) }),
  // Counted under the clinic's own keys; a link cannot be guessed, but the password it asks for can be.
  rateLimit: (_input, { ip }) => [{ key: `clinvite:ip:${addressKey(ip)}`, rule: RATE_RULES['signin:ip'] }],
  run: async ({ prisma }, { token, name, password }) => {
    const result = await acceptClInvitation(prisma, { token, name, password, now: new Date() });
    if (!result.ok) {
      if (result.reason === 'password') throw new StudioError('INVALID', SIGN_IN_FAILED, { password: SIGN_IN_FAILED });
      if (result.reason === 'weak') {
        const message = passwordProblemMessage(checkPasswordPolicy(password) ?? 'TOO_SHORT');
        throw new StudioError('INVALID', message, { password: message });
      }
      throw new StudioError('INVALID', INVITATION_REFUSALS[result.reason]);
    }
    await setClSessionCookie(result.sessionToken, result.expiresAt);
    return { next: CLINIC_HOME };
  },
});

export const clinicSignOut = definePublicAction({
  name: 'clinic.signOut',
  input: z.object({}),
  run: async () => {
    await clearClSessionCookie();
    return { next: '/clinic/sign-in' };
  },
});
