import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as board from '@/server/clinic/actions/board';
import { routeDoctor } from '@/server/clinic/booking/routing';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { fromLocal, localDay, weekdayOf } from '@/server/clinic/time';
import { getPrisma } from '@/server/data/prisma';
import { restaurantDb } from '@/server/data/tenant-db';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The day board and the routing of walk-ins to doctors. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, restaurantId: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId, role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, space: 'CLINIC' as const, memberId: member.id };
}

/** A doctor who works every day, all day, so tests do not depend on the hour they run at. */
async function doctor(email: string, speciality = '', restaurantId = 'clinic-a') {
  const who = await person(email, restaurantId, 'DOCTOR');
  const row = await prisma().clDoctor.create({ data: { restaurantId, memberId: who.memberId, speciality } });
  for (let weekday = 0; weekday < 7; weekday += 1) await prisma().clDoctorHours.create({ data: { restaurantId, doctorId: row.id, weekday, startMin: 0, endMin: 1440 } });
  return { who, row };
}

async function patient(name: string, restaurantId = 'clinic-a') {
  const household = await prisma().clHousehold.create({ data: { restaurantId, phone: `0770${Math.floor(Math.random() * 1e7)}` } });
  return prisma().clPatient.create({ data: { restaurantId, householdId: household.id, name, phone: household.phone } });
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);
const db = () => restaurantDb(prisma(), 'clinic-a');

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().restaurant.create({ data: { id: 'clinic-b', name: 'Bright Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a' } });
});

describe('routing a walk-in', () => {
  const now = new Date();
  const base = { now, patientId: 'none', speciality: undefined, lastTurnDoctorId: null };

  it('SHORTEST_WAIT picks the doctor with the fewest open tickets, earliest doctor on a tie', async () => {
    const a = await doctor('a@a.test');
    const b = await doctor('b@a.test');
    const p = await patient('P');
    expect((await routeDoctor(db(), { ...base, rule: 'SHORTEST_WAIT' }))?.doctorId).toBe(a.row.id);
    await prisma().clTicket.create({ data: { restaurantId: 'clinic-a', day: localDay(now), number: 1, patientId: p.id, doctorId: a.row.id } });
    expect((await routeDoctor(db(), { ...base, rule: 'SHORTEST_WAIT' }))?.doctorId).toBe(b.row.id);
  });

  it('OWN_DOCTOR returns the patient to their last doctor, else the shortest wait', async () => {
    const a = await doctor('a@a.test');
    const b = await doctor('b@a.test');
    const p = await patient('P');
    const fresh = await patient('Fresh');
    await prisma().clTicket.create({ data: { restaurantId: 'clinic-a', day: '2020-01-01', number: 1, patientId: p.id, doctorId: b.row.id, status: 'DONE' } });
    expect((await routeDoctor(db(), { ...base, patientId: p.id, rule: 'OWN_DOCTOR' }))?.doctorId).toBe(b.row.id);
    expect((await routeDoctor(db(), { ...base, patientId: fresh.id, rule: 'OWN_DOCTOR' }))?.doctorId).toBe(a.row.id);
  });

  it('SPECIALITY picks a doctor of the asked speciality, else the shortest wait', async () => {
    await doctor('a@a.test', 'Dentist');
    const b = await doctor('b@a.test', 'Skin');
    expect((await routeDoctor(db(), { ...base, rule: 'SPECIALITY', speciality: ' skin ' }))?.doctorId).toBe(b.row.id);
    expect((await routeDoctor(db(), { ...base, rule: 'SPECIALITY', speciality: 'Heart' }))).not.toBeNull();
  });

  it('TURN goes round the doctors in order, and starts again after the last', async () => {
    const a = await doctor('a@a.test');
    const b = await doctor('b@a.test');
    expect((await routeDoctor(db(), { ...base, rule: 'TURN', lastTurnDoctorId: null }))?.doctorId).toBe(a.row.id);
    expect((await routeDoctor(db(), { ...base, rule: 'TURN', lastTurnDoctorId: a.row.id }))?.doctorId).toBe(b.row.id);
    expect((await routeDoctor(db(), { ...base, rule: 'TURN', lastTurnDoctorId: b.row.id }))?.doctorId).toBe(a.row.id);
  });

  it('never picks a switched-off doctor, one whose person is off, or a doctor of another clinic; none at all gives null', async () => {
    const a = await doctor('a@a.test');
    const off = await doctor('off@a.test');
    const gone = await doctor('gone@a.test');
    await doctor('b@b.test', '', 'clinic-b');
    await prisma().clDoctor.update({ where: { id: off.row.id }, data: { active: false } });
    await prisma().clMember.update({ where: { id: gone.who.memberId }, data: { status: 'DISABLED' } });
    for (let i = 0; i < 3; i += 1) {
      const p = await patient(`P${i}`);
      const picked = await routeDoctor(db(), { ...base, rule: 'SHORTEST_WAIT' });
      expect(picked?.doctorId).toBe(a.row.id);
      await prisma().clTicket.create({ data: { restaurantId: 'clinic-a', day: localDay(now), number: i + 1, patientId: p.id, doctorId: a.row.id } });
    }
    await prisma().clDoctor.update({ where: { id: a.row.id }, data: { active: false } });
    expect(await routeDoctor(db(), { ...base, rule: 'SHORTEST_WAIT' })).toBeNull();
  });

  it('prefers a doctor who is working now over one who is not', async () => {
    const a = await doctor('a@a.test');
    const b = await doctor('b@a.test');
    // a works only in a block that does not contain "now"; b all day.
    await prisma().clDoctorHours.deleteMany({ where: { doctorId: a.row.id } });
    const noon = fromLocal(localDay(now), 12 * 60);
    await prisma().clDoctorHours.create({ data: { restaurantId: 'clinic-a', doctorId: a.row.id, weekday: weekdayOf(localDay(now)), startMin: 0, endMin: 60 } });
    expect((await routeDoctor(db(), { ...base, now: noon, rule: 'SHORTEST_WAIT' }))?.doctorId).toBe(b.row.id);
  });
});

describe('walk-ins, check-in and the number', () => {
  it('numbers a day’s tokens one, two, three, and a booked patient’s check-in takes the next number for the booked doctor', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const a = await doctor('a@a.test');
    const [p1, p2, p3] = [await patient('P1'), await patient('P2'), await patient('P3')];
    const first = await runClAction(prisma(), rec, board.addWalkIn, { patientId: p1.id });
    const second = await runClAction(prisma(), rec, board.addWalkIn, { patientId: p2.id });
    expect([first.ok && first.data.number, second.ok && second.data.number]).toEqual([1, 2]);
    const b = await doctor('b@a.test');
    const start = new Date(Date.now() + 3_600_000);
    const booking = await prisma().clBooking.create({ data: { restaurantId: 'clinic-a', doctorId: b.row.id, patientId: p3.id, startsAt: start, endsAt: new Date(start.getTime() + 900_000) } });
    const arrived = await runClAction(prisma(), rec, board.checkIn, { bookingId: booking.id });
    expect(arrived.ok && arrived.data.number).toBe(3);
    const ticket = await prisma().clTicket.findFirstOrThrow({ where: { number: 3 } });
    expect([ticket.doctorId, ticket.bookingId, ticket.status]).toEqual([b.row.id, booking.id, 'WAITING']);
    expect((await prisma().clBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CHECKED_IN');
    expect(code(await runClAction(prisma(), rec, board.checkIn, { bookingId: booking.id }))).toBe('INVALID');
    expect(a.row.id).toBeTruthy();
  });

  it('never gives two walk-ins at once the same number', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    await doctor('a@a.test');
    const people = await Promise.all([patient('A'), patient('B'), patient('C'), patient('D')]);
    const results = await Promise.all(people.map((p) => runClAction(prisma(), rec, board.addWalkIn, { patientId: p.id })));
    expect(results.every((r) => r.ok)).toBe(true);
    const numbers = (await prisma().clTicket.findMany({ orderBy: { number: 'asc' } })).map((t) => t.number);
    expect(numbers).toEqual([1, 2, 3, 4]);
  });

  it('routes by the clinic’s rule, advances the turn, and takes a chosen doctor as given; refuses another clinic’s patient or doctor', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const a = await doctor('a@a.test');
    const b = await doctor('b@a.test');
    const other = await doctor('x@b.test', '', 'clinic-b');
    expect((await runClAction(prisma(), owner, board.saveDistribution, { rule: 'TURN' })).ok).toBe(true);
    const [p1, p2, p3] = [await patient('P1'), await patient('P2'), await patient('P3')];
    await runClAction(prisma(), rec, board.addWalkIn, { patientId: p1.id });
    await runClAction(prisma(), rec, board.addWalkIn, { patientId: p2.id });
    const tickets = await prisma().clTicket.findMany({ orderBy: { number: 'asc' } });
    expect(tickets.map((t) => t.doctorId)).toEqual([a.row.id, b.row.id]);
    const chosen = await runClAction(prisma(), rec, board.addWalkIn, { patientId: p3.id, doctorId: a.row.id });
    expect(chosen.ok).toBe(true);
    const stranger = await patient('Z', 'clinic-b');
    expect(code(await runClAction(prisma(), rec, board.addWalkIn, { patientId: stranger.id }))).toBe('NOT_FOUND');
    expect(code(await runClAction(prisma(), rec, board.addWalkIn, { patientId: p1.id, doctorId: other.row.id }))).toBe('NOT_FOUND');
  });

  it('refuses a walk-in when no doctor is available', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const p = await patient('P');
    expect(code(await runClAction(prisma(), rec, board.addWalkIn, { patientId: p.id }))).toBe('INVALID');
  });
});

describe('the ticket’s journey', () => {
  async function seeded() {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const cashier = await person('cash@a.test', 'clinic-a', 'CASHIER');
    const a = await doctor('a@a.test');
    const b = await doctor('b@a.test');
    const p = await patient('Sara');
    await runClAction(prisma(), rec, board.addWalkIn, { patientId: p.id, doctorId: a.row.id });
    const ticket = await prisma().clTicket.findFirstOrThrow({});
    return { rec, cashier, a, b, p, ticket };
  }

  it('goes waiting, with the doctor, to pay, done; a stale step is refused', async () => {
    const { rec, cashier, a, ticket } = await seeded();
    expect(code(await runClAction(prisma(), a.who, board.endVisit, { ticketId: ticket.id }))).toBe('INVALID');
    expect((await runClAction(prisma(), a.who, board.callTicket, { ticketId: ticket.id })).ok).toBe(true);
    expect(code(await runClAction(prisma(), a.who, board.callTicket, { ticketId: ticket.id }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), rec, board.moveTicket, { ticketId: ticket.id, doctorId: a.row.id }))).toBe('INVALID');
    const fee = await prisma().clDoctorFee.create({ data: { restaurantId: 'clinic-a', doctorId: a.row.id, label: 'Consultation', amount: 20000 } });
    expect((await runClAction(prisma(), a.who, board.endVisit, { ticketId: ticket.id, feeIds: [fee.id] })).ok).toBe(true);
    expect((await prisma().clTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe('TO_PAY');
    // An open bill is settled at the till, not by closing the token.
    expect(code(await runClAction(prisma(), cashier, board.finishTicket, { ticketId: ticket.id }))).toBe('INVALID');
    const bill = await prisma().clBill.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await prisma().clBill.update({ where: { id: bill.id }, data: { status: 'PAID', paid: bill.total } });
    expect((await runClAction(prisma(), cashier, board.finishTicket, { ticketId: ticket.id })).ok).toBe(true);
    expect((await prisma().clTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe('DONE');
  });

  it('lets the receptionist move a waiting token, and a doctor hand a patient on, which starts the wait again', async () => {
    const { rec, a, b, ticket } = await seeded();
    expect((await runClAction(prisma(), rec, board.moveTicket, { ticketId: ticket.id, doctorId: b.row.id })).ok).toBe(true);
    expect((await prisma().clTicket.findUniqueOrThrow({ where: { id: ticket.id } })).doctorId).toBe(b.row.id);
    await runClAction(prisma(), b.who, board.callTicket, { ticketId: ticket.id });
    expect((await runClAction(prisma(), b.who, board.handOver, { ticketId: ticket.id, doctorId: a.row.id })).ok).toBe(true);
    const handed = await prisma().clTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect([handed.doctorId, handed.status, handed.handedFromDoctorId]).toEqual([a.row.id, 'WAITING', b.row.id]);
    expect(code(await runClAction(prisma(), b.who, board.handOver, { ticketId: ticket.id, doctorId: a.row.id }))).toBe('NOT_FOUND');
  });

  it('keeps a doctor to their own tickets', async () => {
    const { b, ticket } = await seeded();
    expect(code(await runClAction(prisma(), b.who, board.callTicket, { ticketId: ticket.id }))).toBe('NOT_FOUND');
    expect(code(await runClAction(prisma(), b.who, board.handOver, { ticketId: ticket.id, doctorId: b.row.id }))).toBe('NOT_FOUND');
  });

  it('marks a patient who left, and refuses a ticket of another clinic', async () => {
    const { rec, ticket } = await seeded();
    const b = await person('rec@b.test', 'clinic-b', 'RECEPTION');
    expect(code(await runClAction(prisma(), b, board.markLeft, { ticketId: ticket.id }))).toBe('NOT_FOUND');
    expect((await runClAction(prisma(), rec, board.markLeft, { ticketId: ticket.id })).ok).toBe(true);
    expect((await prisma().clTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe('LEFT');
  });
});

describe('who sees which tokens', () => {
  it('shows the owner and receptionist all of today, a doctor only their own, and the cashier only what is to pay or done', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const cashier = await person('cash@a.test', 'clinic-a', 'CASHIER');
    const a = await doctor('a@a.test');
    const b = await doctor('b@a.test');
    const [p1, p2, p3] = [await patient('P1'), await patient('P2'), await patient('P3')];
    await runClAction(prisma(), rec, board.addWalkIn, { patientId: p1.id, doctorId: a.row.id });
    await runClAction(prisma(), rec, board.addWalkIn, { patientId: p2.id, doctorId: b.row.id });
    await runClAction(prisma(), rec, board.addWalkIn, { patientId: p3.id, doctorId: a.row.id });
    const t3 = await prisma().clTicket.findFirstOrThrow({ where: { number: 3 } });
    await runClAction(prisma(), a.who, board.callTicket, { ticketId: t3.id });
    await runClAction(prisma(), a.who, board.endVisit, { ticketId: t3.id });
    const names = async (who: ClSessionView) => {
      const result = await runClAction(prisma(), who, board.loadBoard, {});
      return result.ok ? result.data.tickets.map((t) => t.patientName).sort() : result.error.code;
    };
    expect(await names(rec)).toEqual(['P1', 'P2', 'P3']);
    expect(await names(a.who)).toEqual(['P1', 'P3']);
    expect(await names(b.who)).toEqual(['P2']);
    expect(await names(cashier)).toEqual(['P3']);
  });

  it('lists today’s bookings still to arrive, for the owner and receptionist only', async () => {
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const a = await doctor('a@a.test');
    const p = await patient('Sara');
    const soon = new Date(Date.now() + 60_000);
    await prisma().clBooking.create({ data: { restaurantId: 'clinic-a', doctorId: a.row.id, patientId: p.id, startsAt: soon, endsAt: new Date(soon.getTime() + 900_000) } });
    const result = await runClAction(prisma(), rec, board.listArrivals, {});
    if (localDay(soon) === localDay(new Date())) expect(result.ok && result.data.map((b) => b.patientName)).toEqual(['Sara']);
    expect(code(await runClAction(prisma(), a.who, board.listArrivals, {}))).toBe('FORBIDDEN');
  });
});

describe('the rule setting', () => {
  it('is the owner’s to change, and anyone at the desk may read it', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    expect(code(await runClAction(prisma(), rec, board.saveDistribution, { rule: 'TURN' }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), owner, board.saveDistribution, { rule: 'NOPE' }))).toBe('INVALID');
    await runClAction(prisma(), owner, board.saveDistribution, { rule: 'SPECIALITY' });
    const read = await runClAction(prisma(), rec, board.getDistribution, {});
    expect(read.ok && read.data.rule).toBe('SPECIALITY');
  });
});
