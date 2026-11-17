'use server';

import { invokeCl } from '@/server/clinic/access';
import * as visits from '@/server/clinic/actions/visits';

export async function getVisit(input: unknown) {
  return invokeCl(visits.getVisit, input);
}

export async function listPatientVisits(input: unknown) {
  return invokeCl(visits.listPatientVisits, input);
}
