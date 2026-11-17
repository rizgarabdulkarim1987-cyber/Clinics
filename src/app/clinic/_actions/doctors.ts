'use server';

import { invokeCl } from '@/server/clinic/access';
import * as doctors from '@/server/clinic/actions/doctors';

export async function saveDoctorProfile(input: unknown) {
  return invokeCl(doctors.saveDoctorProfile, input);
}

export async function saveDoctorHours(input: unknown) {
  return invokeCl(doctors.saveDoctorHours, input);
}

export async function saveDoctorFees(input: unknown) {
  return invokeCl(doctors.saveDoctorFees, input);
}

export async function saveDoctorShare(input: unknown) {
  return invokeCl(doctors.saveDoctorShare, input);
}

export async function listDoctorLeaves(input: unknown) {
  return invokeCl(doctors.listDoctorLeaves, input);
}

export async function addDoctorLeave(input: unknown) {
  return invokeCl(doctors.addDoctorLeave, input);
}

export async function removeDoctorLeave(input: unknown) {
  return invokeCl(doctors.removeDoctorLeave, input);
}
