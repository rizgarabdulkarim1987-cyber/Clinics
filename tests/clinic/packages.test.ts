import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bills from '@/server/clinic/actions/bills';
import * as board from '@/server/clinic/actions/board';
import * as packages from '@/server/clinic/actions/packages';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { localDay } from '@/server/clinic/time';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Courses: selling a package, and spending its sessions one visit at a time. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId: 'clinic-a', role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, space: 'CLINIC' as const, memberId: member.id };
}

let owner: ClSessionView;
let reception: ClSessionView;
let cashier: ClSessionView;
let dr: { who: ClSessionView & { memberId: string }; row: { id: string }; fee: { id: string } };

async function patient(name: string) {
  const household = await prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone: `0770${Math.floor(Math.random() * 1e7)}` } });
  return prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId: household.id, name, phone: household.phone } });
}

let number = 100;
async function withDoctor(patientId: string) {
  number += 1;
  return prisma().clTicket.create({ data: { restaurantId: 'clinic-a', day: localDay(new Date()), number, patientId, doctorId: dr.row.id, status: 'WITH_DOCTOR' } });
}

async function course(sessions = 3, price = 90000) {
  const made = await runClAction(prisma(), owner, packages.savePackage, { name: 'Laser course', sessions, price, active: true });
  expect(made.ok).toBe(true);
  return prisma().clPackage.findFirstOrThrow({});
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);
const data = <T>(result: { ok: boolean; data?: T }) => result.data as T;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a' } });
  owner = await person('owner@a.test', 'OWNER');
  reception = await person('desk@a.test', 'RECEPTION');
  cashier = await person('till@a.test', 'CASHIER');
  const who = await person('dr@a.test', 'DOCTOR');
  const row = await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: who.memberId } });
  const fee = await prisma().clDoctorFee.create({ data: { restaurantId: 'clinic-a', doctorId: row.id, label: 'Consultation', amount: 25000 } });
  dr = { who, row, fee };
});

describe('the courses the clinic sells', () => {
  it('only the owner defines them, within range', async () => {
    expect(code(await runClAction(prisma(), owner, packages.savePackage, { name: 'Course', sessions: 5, price: 100000, active: true }))).toBe('OK');
    expect(code(await runClAction(prisma(), reception, packages.savePackage, { name: 'Course', sessions: 5, price: 100000, active: true }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), owner, packages.savePackage, { name: 'Course', sessions: 0, price: 100000, active: true }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), owner, packages.savePackage, { name: '', sessions: 5, price: 100000, active: true }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), owner, packages.savePackage, { name: 'Course', sessions: 5, price: -1, active: true }))).toBe('INVALID');
    expect(data<unknown[]>(await runClAction(prisma(), reception, packages.listPackages, {}))).toHaveLength(1);
  });

  it('edits one in place', async () => {
    const pack = await course();
    await runClAction(prisma(), owner, packages.savePackage, { packageId: pack.id, name: 'Laser 4', sessions: 4, price: 100000, active: false });
    expect(await prisma().clPackage.count()).toBe(1);
    expect(await prisma().clPackage.findFirstOrThrow({})).toMatchObject({ name: 'Laser 4', sessions: 4, active: false });
  });
});

describe('selling a course', () => {
  it('makes a token to pay with a one-line bill, and gives the patient the sessions', async () => {
    const pack = await course();
    const p = await patient('Sara');
    const sold = await runClAction(prisma(), reception, packages.sellPackage, { patientId: p.id, packageId: pack.id, doctorId: dr.row.id });
    expect(code(sold)).toBe('OK');
    const bill = await prisma().clBill.findFirstOrThrow({});
    expect(bill).toMatchObject({ total: 90000, status: 'OPEN', patientId: p.id });
    expect((await prisma().clTicket.findFirstOrThrow({ where: { id: bill.ticketId } })).status).toBe('TO_PAY');
    expect(await prisma().clVisit.count()).toBe(0);
    expect(await prisma().clPatientPackage.findFirstOrThrow({})).toMatchObject({ sessionsLeft: 3, sessionsTotal: 3, patientId: p.id, billId: bill.id });
    expect(code(await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 90000 }))).toBe('OK');
  });

  it('refuses an inactive course, an unknown patient and the cashier', async () => {
    const pack = await course();
    const p = await patient('Sara');
    expect(code(await runClAction(prisma(), cashier, packages.sellPackage, { patientId: p.id, packageId: pack.id, doctorId: dr.row.id }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), reception, packages.sellPackage, { patientId: 'nobody', packageId: pack.id, doctorId: dr.row.id }))).toBe('NOT_FOUND');
    await prisma().clPackage.update({ where: { id: pack.id }, data: { active: false } });
    expect(code(await runClAction(prisma(), reception, packages.sellPackage, { patientId: p.id, packageId: pack.id, doctorId: dr.row.id }))).toBe('NOT_FOUND');
  });
});

describe('spending a session', () => {
  async function bought(sessions = 3) {
    const pack = await course(sessions);
    const p = await patient('Sara');
    await runClAction(prisma(), reception, packages.sellPackage, { patientId: p.id, packageId: pack.id, doctorId: dr.row.id });
    const owned = await prisma().clPatientPackage.findFirstOrThrow({ where: { patientId: p.id } });
    return { p, owned };
  }

  it('a visit that uses a session charges nothing for it, and the visit closes', async () => {
    const { p, owned } = await bought();
    const ticket = await withDoctor(p.id);
    expect(data<{ name: string; sessionsLeft: number }[]>(await runClAction(prisma(), dr.who, board.listTicketPackages, { ticketId: ticket.id }))).toMatchObject([{ name: 'Laser course', sessionsLeft: 3 }]);
    expect(code(await runClAction(prisma(), dr.who, board.endVisit, { ticketId: ticket.id, packageId: owned.id }))).toBe('OK');
    expect((await prisma().clPatientPackage.findFirstOrThrow({ where: { id: owned.id } })).sessionsLeft).toBe(2);
    expect((await prisma().clTicket.findFirstOrThrow({ where: { id: ticket.id } })).status).toBe('DONE');
    expect((await prisma().clBill.findFirstOrThrow({ where: { ticketId: ticket.id } })).total).toBe(0);
  });

  it('still charges the fees ticked beside it', async () => {
    const { p, owned } = await bought();
    const ticket = await withDoctor(p.id);
    await runClAction(prisma(), dr.who, board.endVisit, { ticketId: ticket.id, packageId: owned.id, feeIds: [dr.fee.id] });
    expect((await prisma().clBill.findFirstOrThrow({ where: { ticketId: ticket.id } })).total).toBe(25000);
  });

  it('refuses another patient\'s course and a used-up one, leaving the visit open', async () => {
    const { owned } = await bought(1);
    const stranger = await patient('Other');
    const strangerTicket = await withDoctor(stranger.id);
    expect(code(await runClAction(prisma(), dr.who, board.endVisit, { ticketId: strangerTicket.id, packageId: owned.id }))).toBe('NOT_FOUND');
    expect((await prisma().clTicket.findFirstOrThrow({ where: { id: strangerTicket.id } })).status).toBe('WITH_DOCTOR');
    const own = await prisma().clPatientPackage.findFirstOrThrow({ where: { id: owned.id } });
    const first = await withDoctor(own.patientId);
    expect(code(await runClAction(prisma(), dr.who, board.endVisit, { ticketId: first.id, packageId: owned.id }))).toBe('OK');
    const second = await withDoctor(own.patientId);
    expect(code(await runClAction(prisma(), dr.who, board.endVisit, { ticketId: second.id, packageId: owned.id }))).toBe('INVALID');
    expect((await prisma().clTicket.findFirstOrThrow({ where: { id: second.id } })).status).toBe('WITH_DOCTOR');
  });

  it('two visits at once spend the last session once', async () => {
    const { p, owned } = await bought(1);
    const a = await withDoctor(p.id);
    const b = await withDoctor(p.id);
    const results = await Promise.all([a, b].map((t) => runClAction(prisma(), dr.who, board.endVisit, { ticketId: t.id, packageId: owned.id })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await prisma().clPatientPackage.findFirstOrThrow({ where: { id: owned.id } })).sessionsLeft).toBe(0);
  });

  it('a doctor sees only the courses of their own ticket\'s patient', async () => {
    const { p } = await bought();
    const ticket = await withDoctor(p.id);
    const other = await person('dr2@a.test', 'DOCTOR');
    await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: other.memberId } });
    expect(code(await runClAction(prisma(), other, board.listTicketPackages, { ticketId: ticket.id }))).toBe('NOT_FOUND');
  });
});
