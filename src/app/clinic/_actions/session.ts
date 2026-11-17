'use server';

import { invokePublic } from '@/server/studio/framework/invoke';
import * as session from '@/server/clinic/public-actions/session';

export async function clinicSignIn(input: unknown) {
  return invokePublic(session.clinicSignIn, input);
}

export async function clinicSignOut(input: unknown) {
  return invokePublic(session.clinicSignOut, input);
}
