'use server';

import { invokeCl } from '@/server/clinic/access';
import * as packages from '@/server/clinic/actions/packages';

export async function listPackages(input: unknown) {
  return invokeCl(packages.listPackages, input);
}

export async function savePackage(input: unknown) {
  return invokeCl(packages.savePackage, input);
}

export async function sellPackage(input: unknown) {
  return invokeCl(packages.sellPackage, input);
}
