'use server';

import { chooseClinic, invokeCl } from '@/server/clinic/access';
import * as staff from '@/server/clinic/actions/staff';
import { spaceHome } from '@/server/clinic/space';
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
  const chosen = await chooseClinic(restaurantId);
  return chosen.ok ? ({ ok: true, data: { next: spaceHome(chosen.space) } } as const) : failure('NOT_FOUND');
}
