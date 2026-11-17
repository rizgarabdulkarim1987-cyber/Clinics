import { z } from 'zod';
import { setClSessionCookie, clearClSessionCookie } from '@/server/clinic/auth/cookie';
import { normalizeClEmail, signInClinic } from '@/server/clinic/auth/sign-in';
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

export const clinicSignOut = definePublicAction({
  name: 'clinic.signOut',
  input: z.object({}),
  run: async () => {
    await clearClSessionCookie();
    return { next: '/clinic/sign-in' };
  },
});
