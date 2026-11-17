'use server';

import { invokeCl } from '@/server/clinic/access';
import * as reports from '@/server/clinic/actions/reports';

export async function dayReport(input: unknown) {
  return invokeCl(reports.dayReport, input);
}

export async function doctorShares(input: unknown) {
  return invokeCl(reports.doctorShares, input);
}
