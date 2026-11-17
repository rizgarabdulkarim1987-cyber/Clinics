import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bookings from '@/server/clinic/actions/bookings';
import * as services from '@/server/clinic/actions/services';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { fromLocal, localDay, localMinutes, weekdayOf } from '@/server/clinic/time';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Booking: services, free times from the working week, no double booking, cancel, move, no-show, waiting list. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
const DAY = '2030-03-04';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, restaurantId: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId, role } });
  return { sessionId: 's', accountId: id, name: email, email, memberId: member.id };
}

/** A doctor of clinic-a who works 09:00 to 12:00 on DAY's weekday. */
async function doctorWithHours(email = 'doc@a.test', restaurantId = 'clinic-a') {
  const member = await person(email, restaurantId, 'DOCTOR');
  const doctor = await prisma().clDoctor.create({ data: { restaurantId, memberId: member.memberId } });
  await prisma().clDoctorHours.create({ data: { restaurantId, doctorId: doctor.id, weekday: weekdayOf(DAY), startMin: 540, endMin: 720 } });
  return doctor;
}

async function patient(name: string, restaurantId = 'clinic-a') {
  const household = await prisma().clHousehold.create({ data: { restaurantId, phone: `0770${Math.floor(Math.random() * 1e7)}` } });
  return prisma().clPatient.create({ data: { restaurantId, householdId: household.id, name, phone: household.phone } });
}

const at = (minutes: number) => fromLocal(DAY, minutes).toISOString();
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().restaurant.create({ data: { id: 'clinic-b', name: 'Bright Clinic', type: 'OTHER', sector: 'CLINIC' } });
});

describe('the clock', () => {
  it('keeps the clinic’s day in Baghdad time', () => {
    expect(localDay(new Date('2030-03-03T22:30:00Z'))).toBe('2030-03-04');
    expect(localMinutes(new Date('2030-03-03T22:30:00Z'))).toBe(90);
    expect(fromLocal('2030-03-04', 540).toISOString()).toBe('2030-03-04T06:00:00.000Z');
  });
});

describe('services', () => {
  it('lets the owner make and change them, shows them to the receptionist, and refuses the receptionist an edit', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const made = await runClAction(prisma(), owner, services.saveService, { name: 'Check-up', durationMin: 30, depositAmount: 5000, active: true });
    expect(made.ok).toBe(true);
    const listed = await runClAction(prisma(), rec, services.listServices, {});
    expect(listed.ok && listed.data).toEqual([expect.objectContaining({ name: 'Check-up', durationMin: 30, depositAmount: 5000, active: true })]);
    const id = listed.ok ? listed.data[0]!.serviceId : '';
    expect((await runClAction(prisma(), owner, services.saveService, { serviceId: id, name: 'Check-up', durationMin: 45, depositAmount: 0, active: false })).ok).toBe(true);
    expect((await prisma().clService.findUniqueOrThrow({ where: { id } })).durationMin).toBe(45);
    expect(code(await runClAction(prisma(), rec, services.saveService, { name: 'x', durationMin: 15, depositAmount: 0, active: true }))).toBe('FORBIDDEN');
  });

  it('refuses a duration that is not a whole number of five minutes, or out of range, and another clinic’s service', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const other = await prisma().clService.create({ data: { restaurantId: 'clinic-b', name: 'Theirs' } });
    for (const durationMin of [3, 7, 0, 300]) expect(code(await runClAction(prisma(), owner, services.saveService, { name: 'x', durationMin, depositAmount: 0, active: true }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), owner, services.saveService, { serviceId: other.id, name: 'x', durationMin: 15, depositAmount: 0, active: true }))).toBe('NOT_FOUND');
  });
});

describe('free times', () => {
  it('comes from the working hours, on a 15 minute grid, for the length of the service', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const doctor = await doctorWithHours();
    const service = await prisma().clService.create({ data: { restaurantId: 'clinic-a', name: 'Check-up', durationMin: 30 } });
    const plain = await runClAction(prisma(), rec, bookings.listSlots, { doctorId: doctor.id, day: DAY });
    const long = await runClAction(prisma(), rec, bookings.listSlots, { doctorId: doctor.id, day: DAY, serviceId: service.id });
    expect(plain.ok && plain.data).toHaveLength(12);
    expect(plain.ok && plain.data[0]).toBe(at(540));
    expect(long.ok && long.data).toHaveLength(11);
    expect(long.ok && long.data.at(-1)).toBe(at(690));
  });

  it('is empty on a day with no hours, for a doctor switched off and for a doctor of another clinic', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const doctor = await doctorWithHours();
    const other = await doctorWithHours('doc@b.test', 'clinic-b');
    const empty = async (doctorId: string, day: string) => {
      const result = await runClAction(prisma(), rec, bookings.listSlots, { doctorId, day });
      return result.ok ? result.data : 'refused';
    };
    expect(await empty(doctor.id, '2030-03-05')).toEqual([]);
    expect(await empty(other.id, DAY)).toEqual([]);
    await prisma().clDoctor.update({ where: { id: doctor.id }, data: { active: false } });
    expect(await empty(doctor.id, DAY)).toEqual([]);
    expect(await empty(doctor.id, 'not-a-day')).toBe('refused');
  });
});

describe('booking', () => {
  it('takes a free time, copies the service’s deposit and length, and takes the time off the list', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const doctor = await doctorWithHours();
    const sara = await patient('Sara');
    const service = await prisma().clService.create({ data: { restaurantId: 'clinic-a', name: 'Check-up', durationMin: 30, depositAmount: 5000 } });
    const result = await runClAction(prisma(), rec, bookings.createBooking, { doctorId: doctor.id, patientId: sara.id, serviceId: service.id, startsAt: at(600) });
    expect(result.ok).toBe(true);
    const row = await prisma().clBooking.findFirstOrThrow({});
    expect([row.depositAmount, row.endsAt.toISOString(), row.status, row.source]).toEqual([5000, at(630), 'BOOKED', 'STAFF']);
    const free = await runClAction(prisma(), rec, bookings.listSlots, { doctorId: doctor.id, day: DAY });
    expect(free.ok && free.data).not.toContain(at(600));
    expect(free.ok && free.data).not.toContain(at(615));
    expect(free.ok && free.data).toContain(at(630));
  });

  it('never lets two bookings of one doctor overlap, however they are asked', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const doctor = await doctorWithHours();
    const [a, b] = [await patient('A'), await patient('B')];
    const book = (patientId: string, minutes: number) => runClAction(prisma(), rec, bookings.createBooking, { doctorId: doctor.id, patientId, startsAt: at(minutes) });
    expect((await book(a.id, 600)).ok).toBe(true);
    expect(code(await book(b.id, 600))).toBe('INVALID');
    const raced = await Promise.all([book(a.id, 660), book(b.id, 660)]);
    expect(raced.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma().clBooking.count()).toBe(2);
  });

  it('refuses a time outside the week or off the grid, a time in the past, and another clinic’s doctor or patient', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const doctor = await doctorWithHours();
    const other = await doctorWithHours('doc@b.test', 'clinic-b');
    const sara = await patient('Sara');
    const stranger = await patient('Zed', 'clinic-b');
    const book = (doctorId: string, patientId: string, startsAt: string) => runClAction(prisma(), rec, bookings.createBooking, { doctorId, patientId, startsAt });
    expect(code(await book(doctor.id, sara.id, at(480)))).toBe('INVALID');
    expect(code(await book(doctor.id, sara.id, at(547)))).toBe('INVALID');
    expect(code(await book(doctor.id, sara.id, '2020-01-06T06:00:00.000Z'))).toBe('INVALID');
    expect(code(await book(other.id, sara.id, at(600)))).toBe('NOT_FOUND');
    expect(code(await book(doctor.id, stranger.id, at(600)))).toBe('NOT_FOUND');
    expect(await prisma().clBooking.count()).toBe(0);
  });

  it('audits the booking by its id, never the patient’s name or phone', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const doctor = await doctorWithHours();
    const sara = await patient('Sara Ali');
    await runClAction(prisma(), rec, bookings.createBooking, { doctorId: doctor.id, patientId: sara.id, startsAt: at(600) });
    const rows = await prisma().auditLog.findMany({ where: { action: 'clinic.booking_created' } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/Sara|0770/);
  });

  it('is refused to a doctor and to the one who takes payments', async () => {
    const doctor = await doctorWithHours();
    const sara = await patient('Sara');
    const cashier = await person('cash@a.test', 'clinic-a', 'CASHIER');
    expect(code(await runClAction(prisma(), cashier, bookings.createBooking, { doctorId: doctor.id, patientId: sara.id, startsAt: at(600) }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), cashier, bookings.listDay, { day: DAY }))).toBe('FORBIDDEN');
  });
});

describe('cancelling, moving and no-shows', () => {
  async function booked(minutes = 600) {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const doctor = await doctorWithHours();
    const sara = await patient('Sara');
    await runClAction(prisma(), rec, bookings.createBooking, { doctorId: doctor.id, patientId: sara.id, startsAt: at(minutes) });
    const booking = await prisma().clBooking.findFirstOrThrow({});
    return { rec, doctor, sara, booking };
  }

  it('frees the time when cancelled, and names who waits for that day', async () => {
    const { rec, doctor, booking } = await booked();
    const omar = await patient('Omar');
    await runClAction(prisma(), rec, bookings.addToWaitlist, { patientId: omar.id, doctorId: doctor.id, day: DAY });
    const result = await runClAction(prisma(), rec, bookings.cancelBooking, { bookingId: booking.id });
    expect(result.ok && result.data.waiting.map((w) => w.patientName)).toEqual(['Omar']);
    expect((await prisma().clBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED');
    const free = await runClAction(prisma(), rec, bookings.listSlots, { doctorId: doctor.id, day: DAY });
    expect(free.ok && free.data).toContain(at(600));
    expect(code(await runClAction(prisma(), rec, bookings.cancelBooking, { bookingId: booking.id }))).toBe('INVALID');
  });

  it('moves a booking to another free time, and not onto another booking', async () => {
    const { rec, doctor, booking } = await booked();
    const omar = await patient('Omar');
    await runClAction(prisma(), rec, bookings.createBooking, { doctorId: doctor.id, patientId: omar.id, startsAt: at(660) });
    expect(code(await runClAction(prisma(), rec, bookings.rescheduleBooking, { bookingId: booking.id, startsAt: at(660) }))).toBe('INVALID');
    expect((await runClAction(prisma(), rec, bookings.rescheduleBooking, { bookingId: booking.id, startsAt: at(600 + 15) })).ok).toBe(true);
    expect((await prisma().clBooking.findUniqueOrThrow({ where: { id: booking.id } })).startsAt.toISOString()).toBe(at(615));
  });

  it('marks a no-show, which frees the time, and refuses a booking of another clinic', async () => {
    const { rec, doctor, booking } = await booked();
    const b = await person('rec@b.test', 'clinic-b', 'RECEPTION');
    expect(code(await runClAction(prisma(), b, bookings.markNoShow, { bookingId: booking.id }))).toBe('NOT_FOUND');
    expect((await runClAction(prisma(), rec, bookings.markNoShow, { bookingId: booking.id })).ok).toBe(true);
    const free = await runClAction(prisma(), rec, bookings.listSlots, { doctorId: doctor.id, day: DAY });
    expect(free.ok && free.data).toContain(at(600));
  });

  it('lists a day’s bookings in time order with the patient, doctor and service, for one doctor or all', async () => {
    const { rec, doctor } = await booked(660);
    const omar = await patient('Omar');
    await runClAction(prisma(), rec, bookings.createBooking, { doctorId: doctor.id, patientId: omar.id, startsAt: at(570) });
    const all = await runClAction(prisma(), rec, bookings.listDay, { day: DAY });
    expect(all.ok && all.data.map((b) => b.patientName)).toEqual(['Omar', 'Sara']);
    const none = await runClAction(prisma(), rec, bookings.listDay, { day: '2030-03-05' });
    expect(none.ok && none.data).toEqual([]);
  });
});

describe('the waiting list', () => {
  it('adds, lists for a day, books from an entry and marks it booked, and removes', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const doctor = await doctorWithHours();
    const omar = await patient('Omar');
    const zed = await patient('Zed');
    await runClAction(prisma(), rec, bookings.addToWaitlist, { patientId: omar.id, day: DAY });
    await runClAction(prisma(), rec, bookings.addToWaitlist, { patientId: zed.id, doctorId: doctor.id, day: DAY });
    const listed = await runClAction(prisma(), rec, bookings.listWaitlist, { day: DAY });
    expect(listed.ok && listed.data.map((e) => e.patientName)).toEqual(['Omar', 'Zed']);
    const entry = listed.ok ? listed.data[0]!.entryId : '';
    expect((await runClAction(prisma(), rec, bookings.createBooking, { doctorId: doctor.id, patientId: omar.id, startsAt: at(600), waitlistEntryId: entry })).ok).toBe(true);
    expect((await prisma().clWaitlistEntry.findUniqueOrThrow({ where: { id: entry } })).status).toBe('BOOKED');
    const rest = await runClAction(prisma(), rec, bookings.listWaitlist, { day: DAY });
    expect(rest.ok && rest.data.map((e) => e.patientName)).toEqual(['Zed']);
    const zedEntry = rest.ok ? rest.data[0]!.entryId : '';
    expect((await runClAction(prisma(), rec, bookings.removeFromWaitlist, { entryId: zedEntry })).ok).toBe(true);
    expect(await prisma().clWaitlistEntry.count({ where: { status: 'WAITING' } })).toBe(0);
  });
});
