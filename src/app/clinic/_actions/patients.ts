'use server';

import { invokeCl } from '@/server/clinic/access';
import * as patients from '@/server/clinic/actions/patients';

export async function searchPatients(input: unknown) {
  return invokeCl(patients.searchPatients, input);
}

export async function createPatient(input: unknown) {
  return invokeCl(patients.createPatient, input);
}

export async function getPatient(input: unknown) {
  return invokeCl(patients.getPatient, input);
}

export async function updatePatient(input: unknown) {
  return invokeCl(patients.updatePatient, input);
}
