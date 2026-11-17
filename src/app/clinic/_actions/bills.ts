'use server';

import { invokeCl } from '@/server/clinic/access';
import * as bills from '@/server/clinic/actions/bills';

export async function listBills(input: unknown) {
  return invokeCl(bills.listBills, input);
}

export async function getRate(input: unknown) {
  return invokeCl(bills.getRate, input);
}

export async function saveRate(input: unknown) {
  return invokeCl(bills.saveRate, input);
}

export async function addBillLine(input: unknown) {
  return invokeCl(bills.addBillLine, input);
}

export async function removeBillLine(input: unknown) {
  return invokeCl(bills.removeBillLine, input);
}

export async function takePayment(input: unknown) {
  return invokeCl(bills.takePayment, input);
}

export async function leaveAsDebt(input: unknown) {
  return invokeCl(bills.leaveAsDebt, input);
}

export async function rescheduleDebt(input: unknown) {
  return invokeCl(bills.rescheduleDebt, input);
}
