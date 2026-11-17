'use server';

import { chooseClinic, invokeCl } from '@/server/clinic/access';
import * as staff from '@/server/clinic/actions/staff';
import { failure } from '@/server/studio/framework/result';

export async function inviteStaff(input: unknown) {
  return invokeCl(staff.inviteStaff, input);
}

export async function revokeStaffInvitation(input: unknown) {
  return invokeCl(staff.revokeStaffInvitation, input);
}

export async function changeStaffRole(input: unknown) {
  return invokeCl(staff.changeStaffRole, input);
}

export async function setStaffActive(input: unknown) {
  return invokeCl(staff.setStaffActive, input);
}

/** Remembers the clinic a person with several chose. */
export async function chooseClinicAction(input: unknown) {
  const restaurantId = typeof input === 'object' && input !== null && 'restaurantId' in input ? String((input as { restaurantId: unknown }).restaurantId) : '';
  return (await chooseClinic(restaurantId)) ? ({ ok: true, data: { next: '/clinic/home' } } as const) : failure('NOT_FOUND');
}
