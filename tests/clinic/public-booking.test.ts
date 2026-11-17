import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPublicClinic, clinicPublicBook, clinicPublicSlots } from '@/server/clinic/public-actions/booking';
import { createClAccount } from '@/server/clinic/auth/sign-in';
import { fromLocal, weekdayOf } from '@/server/clinic/time';
import { getPrisma } from '@/server/data/prisma';
import { runPublicAction } from '@/server/studio/framework/public';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The public booking page: what a stranger may see and do, and what they may not. */

const prisma = () => getPrisma();
const DAY = '2030-03-04';
let n = 0;
const meta = () => ({ ip: `203.0.113.${(n += 1) % 250}`, userAgent: 'vitest', headers: new Headers() });
const at = (minutes: number) => fromLocal(DAY, minutes).toISOString();

async function doctorOf(restaurantId: string, email: string) {
  const { id } = await createClAccount(prisma(), { name: `Dr ${email.split('@')[0]}`, email, password: 'correct horse battery staple' });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId, role: 'DOCTOR' } });
  const doctor = await prisma().clDoctor.create({ data: { restaurantId, memberId: member.id, speciality: 'Dentist' } });
  await prisma().clDoctorHours.create({ data: { restaurantId, doctorId: doctor.id, weekday: weekdayOf(DAY), startMin: 540, endMin: 720 } });
  return doctor;
}

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().restaurant.create({ data: { id: 'clinic-b', name: 'Bright Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().restaurant.create({ data: { id: 'shop-1', name: 'A Pharmacy', type: 'OTHER', sector: 'PHARMACY' } });
});

describe('what the page shows', () => {
  it('names the clinic, its bookable doctors and its services, and nothing of a patient', async () => {
    const doctor = await doctorOf('clinic-a', 'a@a.test');
    await prisma().clService.create({ data: { restaurantId: 'clinic-a', name: 'Check-up', durationMin: 30 } });
    await prisma().clService.create({ data: { restaurantId: 'clinic-a', name: 'Hidden', active: false } });
    const view = await loadPublicClinic(prisma(), 'clinic-a');
    expect(view).toEqual({
      clinicName: 'Smile Clinic',
      doctors: [{ doctorId: doctor.id, name: 'Dr a', speciality: 'Dentist' }],
      services: [expect.objectContaining({ name: 'Check-up', durationMin: 30 })],
    });
    expect(JSON.stringify(view)).not.toMatch(/@a\.test"|passwordHash/);
  });

  it('is not there for an unknown id, another product’s business or a clinic that is not active', async () => {
    expect(await loadPublicClinic(prisma(), 'nope')).toBeNull();
    expect(await loadPublicClinic(prisma(), 'shop-1')).toBeNull();
    await prisma().restaurant.update({ where: { id: 'clinic-b' }, data: { status: 'SUSPENDED' } });
    expect(await loadPublicClinic(prisma(), 'clinic-b')).toBeNull();
  });
});

describe('free times', () => {
  it('lists a doctor’s free times, and none for a doctor of another clinic', async () => {
    const doctor = await doctorOf('clinic-a', 'a@a.test');
    const other = await doctorOf('clinic-b', 'b@b.test');
    const mine = await runPublicAction(prisma(), clinicPublicSlots, { clinicId: 'clinic-a', doctorId: doctor.id, day: DAY }, meta());
    const theirs = await runPublicAction(prisma(), clinicPublicSlots, { clinicId: 'clinic-a', doctorId: other.id, day: DAY }, meta());
    expect(mine.ok && mine.data).toHaveLength(12);
    expect(theirs.ok && theirs.data).toEqual([]);
  });
});

describe('booking', () => {
  it('books a free time as an online booking, makes the patient file and household, and answers with no patient data', async () => {
    const doctor = await doctorOf('clinic-a', 'a@a.test');
    const result = await runPublicAction(prisma(), clinicPublicBook, { clinicId: 'clinic-a', doctorId: doctor.id, startsAt: at(600), name: 'Sara Ali', phone: '+964 770 123 4567' }, meta());
    expect(result.ok).toBe(true);
    const booking = await prisma().clBooking.findFirstOrThrow({ include: { patient: true } });
    expect([booking.source, booking.status, booking.patient.name, booking.patient.phone, booking.restaurantId]).toEqual(['PUBLIC', 'BOOKED', 'Sara Ali', '07701234567', 'clinic-a']);
    expect(JSON.stringify(result)).not.toMatch(/Sara|0770/);
    // The same person booking again reuses their file.
    await runPublicAction(prisma(), clinicPublicBook, { clinicId: 'clinic-a', doctorId: doctor.id, startsAt: at(660), name: 'sara ali', phone: '07701234567' }, meta());
    expect(await prisma().clPatient.count()).toBe(1);
  });

  it('refuses a taken time, a doctor of another clinic and a business that is not a clinic', async () => {
    const doctor = await doctorOf('clinic-a', 'a@a.test');
    const other = await doctorOf('clinic-b', 'b@b.test');
    const book = (clinicId: string, doctorId: string, minutes: number) => runPublicAction(prisma(), clinicPublicBook, { clinicId, doctorId, startsAt: at(minutes), name: 'Omar', phone: '07509998888' }, meta());
    expect((await book('clinic-a', doctor.id, 600)).ok).toBe(true);
    expect(await book('clinic-a', doctor.id, 600)).toMatchObject({ ok: false, error: { code: 'INVALID' } });
    expect(await book('clinic-a', other.id, 600)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await book('shop-1', doctor.id, 660)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await prisma().clBooking.count()).toBe(1);
  });

  it('refuses a missing name and a phone that is not one', async () => {
    const doctor = await doctorOf('clinic-a', 'a@a.test');
    const book = (name: string, phone: string) => runPublicAction(prisma(), clinicPublicBook, { clinicId: 'clinic-a', doctorId: doctor.id, startsAt: at(600), name, phone }, meta());
    expect(await book(' ', '07701234567')).toMatchObject({ ok: false, error: { code: 'INVALID' } });
    expect(await book('Sara', 'abc')).toMatchObject({ ok: false, error: { code: 'INVALID' } });
  });

  it('slows one address down after a few bookings', async () => {
    const doctor = await doctorOf('clinic-a', 'a@a.test');
    const fixed = { ip: '198.51.100.9', userAgent: 'vitest', headers: new Headers() };
    const codes: string[] = [];
    for (let i = 0; i < 22; i += 1) {
      const result = await runPublicAction(prisma(), clinicPublicBook, { clinicId: 'clinic-a', doctorId: doctor.id, startsAt: at(540 + (i % 12) * 15), name: `P${i}`, phone: `0770000${String(i).padStart(4, '0')}` }, fixed);
      codes.push(result.ok ? 'OK' : result.error.code);
    }
    expect(codes).toContain('RATE_LIMITED');
  });
});
