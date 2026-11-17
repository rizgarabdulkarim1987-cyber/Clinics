import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBookingCore, freeSlots } from '@/server/clinic/booking/core';
import { routeDoctor } from '@/server/clinic/booking/routing';
import * as doctors from '@/server/clinic/actions/doctors';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { fromLocal, localDay } from '@/server/clinic/time';
import { restaurantDb } from '@/server/data/tenant-db';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** A doctor on leave has no free times, takes no walk-in, and the owner sees which bookings the leave touches. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
const DAY = 86_400_000;
const dayAhead = (n: number) => localDay(new Date(Date.now() + n * DAY));
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR';

async function person(email: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId: 'clinic-a', role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, space: 'CLINIC' as const, memberId: member.id };
}

let owner: ClSessionView;
let reception: ClSessionView;
let drA: ClSessionView & { memberId: string };
let drB: ClSessionView & { memberId: string };
let idA: string;
let idB: string;
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);
const db = () => restaurantDb(prisma(), 'clinic-a');

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'CAFE', sector: 'CLINIC', status: 'ACTIVE' } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a' } });
  owner = await person('owner@a.test', 'OWNER');
  reception = await person('desk@a.test', 'RECEPTION');
  drA = await person('a@a.test', 'DOCTOR');
  drB = await person('b@a.test', 'DOCTOR');
  idA = (await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: drA.memberId } })).id;
  idB = (await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: drB.memberId } })).id;
  for (const doctorId of [idA, idB]) for (let weekday = 0; weekday < 7; weekday += 1) await prisma().clDoctorHours.create({ data: { restaurantId: 'clinic-a', doctorId, weekday, startMin: 0, endMin: 1440 } });
});

describe('doctor leave', () => {
  it('removes a doctor’s free times on the days of the leave, and only those', async () => {
    const day = dayAhead(3);
    expect((await freeSlots(db(), { doctorId: idA, day, durationMin: 15, now: new Date() })).length).toBeGreaterThan(0);
    expect(code(await runClAction(prisma(), owner, doctors.addDoctorLeave, { memberId: drA.memberId, fromDay: day, toDay: dayAhead(4) }))).toBe('OK');
    expect(await freeSlots(db(), { doctorId: idA, day, durationMin: 15, now: new Date() })).toEqual([]);
    expect(await freeSlots(db(), { doctorId: idA, day: dayAhead(4), durationMin: 15, now: new Date() })).toEqual([]);
    expect((await freeSlots(db(), { doctorId: idA, day: dayAhead(5), durationMin: 15, now: new Date() })).length).toBeGreaterThan(0);
    expect((await freeSlots(db(), { doctorId: idB, day, durationMin: 15, now: new Date() })).length).toBeGreaterThan(0);
  });

  it('refuses a booking on a day of leave', async () => {
    const day = dayAhead(3);
    await runClAction(prisma(), owner, doctors.addDoctorLeave, { memberId: drA.memberId, fromDay: day, toDay: day });
    const household = await prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone: '0770' } });
    const patient = await prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId: household.id, name: 'Ali', phone: '0770' } });
    await expect(createBookingCore(db(), { doctorId: idA, patientId: patient.id, startsAt: fromLocal(day, 600), source: 'STAFF', restaurantId: 'clinic-a', now: new Date() })).rejects.toThrow();
  });

  it('sends a walk-in to a doctor who is not on leave today, and still answers when all are', async () => {
    const today = localDay(new Date());
    await runClAction(prisma(), owner, doctors.addDoctorLeave, { memberId: drA.memberId, fromDay: today, toDay: today });
    const input = { rule: 'SHORTEST_WAIT' as const, now: new Date(), patientId: 'p', speciality: undefined, lastTurnDoctorId: null };
    expect(await routeDoctor(db(), input)).toEqual({ doctorId: idB });
    await runClAction(prisma(), owner, doctors.addDoctorLeave, { memberId: drB.memberId, fromDay: today, toDay: today });
    expect(await routeDoctor(db(), input)).not.toBeNull();
  });

  it('lists leaves with how many booked patients each touches, and lets the owner remove one', async () => {
    const day = dayAhead(2);
    const household = await prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone: '0771' } });
    const patient = await prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId: household.id, name: 'Zainab', phone: '0771' } });
    await prisma().clBooking.create({ data: { restaurantId: 'clinic-a', doctorId: idA, patientId: patient.id, startsAt: fromLocal(day, 600), endsAt: fromLocal(day, 615) } });
    const added = await runClAction(prisma(), owner, doctors.addDoctorLeave, { memberId: drA.memberId, fromDay: day, toDay: day });
    if (!added.ok) throw new Error('expected the leave to be added');
    expect(added.data.affected).toBe(1);
    const listed = await runClAction(prisma(), reception, doctors.listDoctorLeaves, {});
    if (!listed.ok) throw new Error('expected a list');
    expect(listed.data).toMatchObject([{ doctorName: 'a', fromDay: day, toDay: day, affected: 1 }]);
    expect(code(await runClAction(prisma(), owner, doctors.removeDoctorLeave, { leaveId: listed.data[0]!.leaveId }))).toBe('OK');
    expect((await runClAction(prisma(), owner, doctors.listDoctorLeaves, {}))).toMatchObject({ ok: true, data: [] });
  });

  it('checks the dates and the role', async () => {
    const day = dayAhead(3);
    expect(code(await runClAction(prisma(), owner, doctors.addDoctorLeave, { memberId: drA.memberId, fromDay: day, toDay: dayAhead(1) }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), owner, doctors.addDoctorLeave, { memberId: drA.memberId, fromDay: dayAhead(-2), toDay: day }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), owner, doctors.addDoctorLeave, { memberId: drA.memberId, fromDay: day, toDay: dayAhead(400) }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), reception, doctors.addDoctorLeave, { memberId: drA.memberId, fromDay: day, toDay: day }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), owner, doctors.addDoctorLeave, { memberId: 'nobody', fromDay: day, toDay: day }))).toBe('NOT_FOUND');
  });
});
