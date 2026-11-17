'use server';

import { invokeCl } from '@/server/clinic/access';
import * as bookings from '@/server/clinic/actions/bookings';
import * as services from '@/server/clinic/actions/services';

export async function listSlots(input: unknown) {
  return invokeCl(bookings.listSlots, input);
}

export async function createBooking(input: unknown) {
  return invokeCl(bookings.createBooking, input);
}

export async function cancelBooking(input: unknown) {
  return invokeCl(bookings.cancelBooking, input);
}

export async function rescheduleBooking(input: unknown) {
  return invokeCl(bookings.rescheduleBooking, input);
}

export async function markNoShow(input: unknown) {
  return invokeCl(bookings.markNoShow, input);
}

export async function listDay(input: unknown) {
  return invokeCl(bookings.listDay, input);
}

export async function addToWaitlist(input: unknown) {
  return invokeCl(bookings.addToWaitlist, input);
}

export async function listWaitlist(input: unknown) {
  return invokeCl(bookings.listWaitlist, input);
}

export async function removeFromWaitlist(input: unknown) {
  return invokeCl(bookings.removeFromWaitlist, input);
}

export async function saveService(input: unknown) {
  return invokeCl(services.saveService, input);
}
