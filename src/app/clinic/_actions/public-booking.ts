'use server';

import * as booking from '@/server/clinic/public-actions/booking';
import { invokePublic } from '@/server/studio/framework/invoke';

export async function clinicPublicSlots(input: unknown) {
  return invokePublic(booking.clinicPublicSlots, input);
}

export async function clinicPublicBook(input: unknown) {
  return invokePublic(booking.clinicPublicBook, input);
}
