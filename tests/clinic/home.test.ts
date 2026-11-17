import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as home from '@/server/clinic/actions/home';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { fromLocal, localDay } from '@/server/clinic/time';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The home summary: today's queue and bookings for the desk, plus money and missed appointments for the owner only. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
const DAY = 86_400_000;
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId: 'clinic-a', role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, space: 'CLINIC' as const, memberId: member.id };
}

let owner: ClSessionView;
let reception: ClSessionView;
let cashier: ClSessionView;
let doctorId: string;
let patientId: string;
let counter = 0;

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
  cashier = await person('till@a.test', 'CASHIER');
  const who = await person('dr@a.test', 'DOCTOR');
  doctorId = (await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: who.memberId } })).id;
  const household = await prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone: '0770' } });
  patientId = (await prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId: household.id, name: 'Zainab', phone: '0770' } })).id;
});

const ticket = (status: 'WAITING' | 'WITH_DOCTOR' | 'TO_PAY' | 'DONE') => {
  counter += 1;
  return prisma().clTicket.create({ data: { restaurantId: 'clinic-a', day: localDay(new Date()), number: counter, patientId, doctorId, status } });
};
const booking = (startsAt: Date, status: 'BOOKED' | 'DONE' | 'NO_SHOW', remindedAt: Date | null = null) =>
  prisma().clBooking.create({ data: { restaurantId: 'clinic-a', doctorId, patientId, startsAt, endsAt: new Date(startsAt.getTime() + 900_000), status, remindedAt } });

describe('the home summary', () => {
  it('counts the queue, today’s and tomorrow’s bookings, and the reminders still to send', async () => {
    await ticket('WAITING');
    await ticket('WAITING');
    await ticket('WITH_DOCTOR');
    await ticket('TO_PAY');
    const today = localDay(new Date());
    const tomorrow = localDay(new Date(Date.now() + DAY));
    await booking(fromLocal(today, 1430), 'BOOKED');
    await booking(fromLocal(tomorrow, 600), 'BOOKED');
    await booking(fromLocal(tomorrow, 630), 'BOOKED', new Date());
    const result = await runClAction(prisma(), reception, home.homeSummary, {});
    if (!result.ok) throw new Error('expected a summary');
    expect(result.data.queue).toEqual({ waiting: 2, withDoctor: 1, toPay: 1 });
    expect(result.data.bookingsToday).toBe(1);
    expect(result.data.bookingsTomorrow).toBe(2);
    expect(result.data.unreminded).toBe(1);
    expect(result.data.owner).toBeNull();
  });

  it('gives the owner money, debt and the missed-appointment rate of the last 30 days', async () => {
    const bill = async (total: number, paid: number, status: 'PAID' | 'DEBT') => {
      const t = await ticket('DONE');
      return prisma().clBill.create({ data: { restaurantId: 'clinic-a', ticketId: t.id, patientId, doctorId, total, paid, status, dueDay: status === 'DEBT' ? localDay(new Date()) : null } });
    };
    const paidBill = await bill(25000, 25000, 'PAID');
    await bill(40000, 10000, 'DEBT');
    await prisma().clPayment.create({ data: { restaurantId: 'clinic-a', billId: paidBill.id, currency: 'IQD', tendered: 25000, rate: 1500, appliedIqd: 25000, changeIqd: 0, takenById: (await prisma().clMember.findFirstOrThrow({ where: { role: 'OWNER' } })).id } });
    await booking(new Date(Date.now() - 3 * DAY), 'DONE');
    await booking(new Date(Date.now() - 4 * DAY), 'DONE');
    await booking(new Date(Date.now() - 5 * DAY), 'DONE');
    await booking(new Date(Date.now() - 6 * DAY), 'NO_SHOW');
    await booking(new Date(Date.now() - 60 * DAY), 'NO_SHOW');
    const result = await runClAction(prisma(), owner, home.homeSummary, {});
    if (!result.ok) throw new Error('expected a summary');
    expect(result.data.owner).toEqual({ collectedToday: 25000, debt: 30000, noShowPercent: 25 });
  });

  it('is open to the desk and the owner, not the cashier', async () => {
    expect((await runClAction(prisma(), cashier, home.homeSummary, {})).ok).toBe(false);
  });
});
