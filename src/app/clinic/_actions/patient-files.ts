'use server';

import { invokeCl } from '@/server/clinic/access';
import * as files from '@/server/clinic/actions/patient-files';

export async function listFiles(input: unknown) {
  return invokeCl(files.listFiles, input);
}

export async function deleteFile(input: unknown) {
  return invokeCl(files.deleteFile, input);
}
