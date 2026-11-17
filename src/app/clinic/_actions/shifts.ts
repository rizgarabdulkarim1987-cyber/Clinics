'use server';

import { invokeCl } from '@/server/clinic/access';
import * as shifts from '@/server/clinic/actions/shifts';

export async function currentShift(input: unknown) {
  return invokeCl(shifts.currentShift, input);
}

export async function openShift(input: unknown) {
  return invokeCl(shifts.openShift, input);
}

export async function closeShift(input: unknown) {
  return invokeCl(shifts.closeShift, input);
}
