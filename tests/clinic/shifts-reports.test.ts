import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bills from '@/server/clinic/actions/bills';
import * as board from '@/server/clinic/actions/board';
import * as doctors from '@/server/clinic/actions/doctors';
import * as packages from '@/server/clinic/actions/packages';
import * as reports from '@/server/clinic/actions/reports';
import * as shifts from '@/server/clinic/actions/shifts';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { localDay } from '@/server/clinic/time';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The doctor's share, the till shift with its close, and the owner's reports. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, restaurantId: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId, role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, space: 'CLINIC' as const, memberId: member.id };
}

async function doctor(email: string, mode: 'PERCENT' | 'FIXED' | 'RENT' = 'PERCENT', value = 0) {
  const who = await person(email, 'clinic-a', 'DOCTOR');
  const row = await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: who.memberId, shareMode: mode, shareValue: value } });
  const fee = await prisma().clDoctorFee.create({ data: { restaurantId: 'clinic-a', doctorId: row.id, label: 'Consultation', amount: 25000 } });
  return { who, row, fee };
}

async function patient(name: string) {
  const household = await prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone: `0770${Math.floor(Math.random() * 1e7)}` } });
  return prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId: household.id, name, phone: household.phone } });
}

let number = 0;
/** A finished visit with a 25,000 bill for this doctor. */
async function billFor(d: Awaited<ReturnType<typeof doctor>>) {
  number += 1;
  const p = await patient('P');
  const ticket = await prisma().clTicket.create({ data: { restaurantId: 'clinic-a', day: localDay(new Date()), number, patientId: p.id, doctorId: d.row.id, status: 'WITH_DOCTOR' } });
  await runClAction(prisma(), d.who, board.endVisit, { ticketId: ticket.id, feeIds: [d.fee.id] });
  return prisma().clBill.findFirstOrThrow({ where: { ticketId: ticket.id } });
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);
const data = <T>(result: { ok: boolean; data?: T }) => result.data as T;
const today = () => localDay(new Date());

let owner: ClSessionView;
let cashier: ClSessionView;
let reception: ClSessionView;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a', usdRate: 1500 } });
  owner = await person('owner@a.test', 'clinic-a', 'OWNER');
  cashier = await person('till@a.test', 'clinic-a', 'CASHIER');
  reception = await person('desk@a.test', 'clinic-a', 'RECEPTION');
});

describe('how a doctor is paid', () => {
  it('the owner sets it within range and only the owner sees it', async () => {
    const d = await doctor('d@a.test');
    expect(code(await runClAction(prisma(), owner, doctors.saveDoctorShare, { memberId: d.who.memberId, mode: 'PERCENT', value: 40 }))).toBe('OK');
    expect(code(await runClAction(prisma(), owner, doctors.saveDoctorShare, { memberId: d.who.memberId, mode: 'PERCENT', value: 101 }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), owner, doctors.saveDoctorShare, { memberId: d.who.memberId, mode: 'RENT', value: -1 }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), reception, doctors.saveDoctorShare, { memberId: d.who.memberId, mode: 'PERCENT', value: 10 }))).toBe('FORBIDDEN');
    const ownerView = data<{ shareValue?: number }[]>(await runClAction(prisma(), owner, doctors.listDoctors, {}));
    const deskView = data<{ shareValue?: number }[]>(await runClAction(prisma(), reception, doctors.listDoctors, {}));
    expect(ownerView[0]!.shareValue).toBe(40);
    expect(deskView[0]!.shareValue).toBeUndefined();
  });
});

describe('the till shift', () => {
  it('opens once; a second open, even two at once, is refused', async () => {
    const results = await Promise.all([1, 2, 3].map(() => runClAction(prisma(), cashier, shifts.openShift, { openingIqd: 50000 })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(code(await runClAction(prisma(), owner, shifts.openShift, { openingIqd: 0 }))).toBe('INVALID');
    expect(await prisma().clShift.count({ where: { status: 'OPEN' } })).toBe(1);
  });

  it('payments join the open shift and the close compares the count with what the payments say', async () => {
    const d = await doctor('d@a.test');
    const first = await billFor(d);
    const second = await billFor(d);
    await runClAction(prisma(), cashier, shifts.openShift, { openingIqd: 50000 });
    await runClAction(prisma(), cashier, bills.takePayment, { billId: first.id, currency: 'IQD', amount: 30000 });
    await runClAction(prisma(), cashier, bills.takePayment, { billId: second.id, currency: 'USD', amount: 2000 });
    const shift = await prisma().clShift.findFirstOrThrow({});
    expect(await prisma().clPayment.count({ where: { shiftId: shift.id } })).toBe(2);
    const live = data<{ expectedIqd: number; expectedUsd: number } | null>(await runClAction(prisma(), cashier, shifts.currentShift, {}));
    expect(live).toMatchObject({ expectedIqd: 70000, expectedUsd: 2000 });
    const closed = await runClAction(prisma(), cashier, shifts.closeShift, { countedIqd: 69000, countedUsd: 2000 });
    expect(data<{ differenceIqd: number; differenceUsd: number }>(closed)).toMatchObject({ differenceIqd: -1000, differenceUsd: 0 });
    expect(await prisma().clShift.findFirstOrThrow({})).toMatchObject({ status: 'CLOSED', expectedIqd: 70000, expectedUsd: 2000, countedIqd: 69000, countedUsd: 2000 });
    expect(code(await runClAction(prisma(), cashier, shifts.closeShift, { countedIqd: 69000, countedUsd: 2000 }))).toBe('INVALID');
    expect(data<unknown>(await runClAction(prisma(), cashier, shifts.currentShift, {}))).toBeNull();
  });

  it('a payment with no shift open is allowed and has no shift', async () => {
    const d = await doctor('d@a.test');
    const bill = await billFor(d);
    expect(code(await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 25000 }))).toBe('OK');
    expect((await prisma().clPayment.findFirstOrThrow({})).shiftId).toBeNull();
  });

  it('the doctor cannot open or close a shift, and a count must be a whole number', async () => {
    const d = await doctor('d@a.test');
    expect(code(await runClAction(prisma(), d.who, shifts.openShift, { openingIqd: 0 }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), cashier, shifts.openShift, { openingIqd: -5 }))).toBe('INVALID');
    await runClAction(prisma(), cashier, shifts.openShift, { openingIqd: 0 });
    expect(code(await runClAction(prisma(), cashier, shifts.closeShift, { countedIqd: 1.5, countedUsd: 0 }))).toBe('INVALID');
  });

  it('the owner lists past shifts; the cashier does not', async () => {
    await runClAction(prisma(), cashier, shifts.openShift, { openingIqd: 0 });
    await runClAction(prisma(), cashier, shifts.closeShift, { countedIqd: 0, countedUsd: 0 });
    expect(data<unknown[]>(await runClAction(prisma(), owner, shifts.listShifts, {}))).toHaveLength(1);
    expect(code(await runClAction(prisma(), cashier, shifts.listShifts, {}))).toBe('FORBIDDEN');
  });
});

describe('the doctor share report', () => {
  const range = { fromDay: today(), toDay: today() };
  const row = async () => data<{ visits: number; billed: number; collected: number; doctorShare: number; clinicShare: number }[]>(await runClAction(prisma(), owner, reports.doctorShares, range))[0]!;

  it('PERCENT gives the doctor that part of what was collected', async () => {
    const d = await doctor('d@a.test', 'PERCENT', 40);
    const bill = await billFor(d);
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 25000 });
    expect(await row()).toMatchObject({ visits: 1, billed: 25000, collected: 25000, doctorShare: 10000, clinicShare: 15000 });
  });

  it('counts only what was collected, not what was billed', async () => {
    const d = await doctor('d@a.test', 'PERCENT', 50);
    const bill = await billFor(d);
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 10000 });
    expect(await row()).toMatchObject({ billed: 25000, collected: 10000, doctorShare: 5000, clinicShare: 5000 });
  });

  it('FIXED pays a sum per visit that brought money, never more than was collected', async () => {
    const d = await doctor('d@a.test', 'FIXED', 5000);
    const paid = await billFor(d);
    await billFor(d);
    await runClAction(prisma(), cashier, bills.takePayment, { billId: paid.id, currency: 'IQD', amount: 3000 });
    expect(await row()).toMatchObject({ visits: 2, collected: 3000, doctorShare: 3000, clinicShare: 0 });
  });

  it('RENT charges the doctor per day worked and never more than was collected', async () => {
    const d = await doctor('d@a.test', 'RENT', 20000);
    const bill = await billFor(d);
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 25000 });
    expect(await row()).toMatchObject({ collected: 25000, doctorShare: 5000, clinicShare: 20000 });
    await prisma().clDoctor.update({ where: { id: d.row.id }, data: { shareValue: 90000 } });
    expect(await row()).toMatchObject({ doctorShare: 0, clinicShare: 25000 });
  });

  it('does not count a course sale as a visit or a day worked', async () => {
    const d = await doctor('d@a.test', 'FIXED', 5000);
    const p = await patient('Buyer');
    const course = await prisma().clPackage.create({ data: { restaurantId: 'clinic-a', name: 'Five sessions', sessions: 5, price: 100000 } });
    const sold = await runClAction(prisma(), reception, packages.sellPackage, { patientId: p.id, packageId: course.id, doctorId: d.row.id });
    const { billId } = data<{ billId: string }>(sold);
    await runClAction(prisma(), cashier, bills.takePayment, { billId, currency: 'IQD', amount: 100000 });
    expect(await row()).toMatchObject({ visits: 0, collected: 0, doctorShare: 0 });
  });

  it('refuses a range over a year, a backwards range and anyone but the owner', async () => {
    expect(code(await runClAction(prisma(), owner, reports.doctorShares, { fromDay: '2025-01-01', toDay: '2026-06-01' }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), owner, reports.doctorShares, { fromDay: '2026-02-01', toDay: '2026-01-01' }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), reception, reports.doctorShares, range))).toBe('FORBIDDEN');
  });
});

describe('the day report', () => {
  it('adds up visits, billing, money in each currency, change, debts and payments outside a shift', async () => {
    const d = await doctor('d@a.test');
    const a = await billFor(d);
    const b = await billFor(d);
    await runClAction(prisma(), cashier, bills.takePayment, { billId: a.id, currency: 'IQD', amount: 30000 });
    await runClAction(prisma(), cashier, bills.leaveAsDebt, { billId: b.id, dueDay: today() });
    const report = data<Record<string, number | string>>(await runClAction(prisma(), owner, reports.dayReport, { day: today() }));
    expect(report).toMatchObject({ visits: 2, billed: 50000, appliedIqd: 25000, receivedIqd: 30000, receivedUsdCents: 0, changeIqd: 5000, debtCount: 1, debtBalance: 25000, unshiftedPayments: 1 });
    expect(code(await runClAction(prisma(), cashier, reports.dayReport, { day: today() }))).toBe('FORBIDDEN');
  });
});
