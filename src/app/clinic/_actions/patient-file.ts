'use server';

import { invokeCl } from '@/server/clinic/access';
import * as files from '@/server/clinic/actions/patient-file';

export async function getPatientFile(input: unknown) {
  return invokeCl(files.getPatientFile, input);
}

export async function getPatientAlert(input: unknown) {
  return invokeCl(files.getPatientAlert, input);
}

export async function savePatientAlert(input: unknown) {
  return invokeCl(files.savePatientAlert, input);
}
