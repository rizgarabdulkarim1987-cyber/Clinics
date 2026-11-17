import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bills from '@/server/clinic/actions/bills';
import * as recall from '@/server/clinic/actions/recall';
import * as reports from '@/server/clinic/actions/reports';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { localDay } from '@/server/clinic/time';
import { loadWaitingRoom } from '@/server/clinic/waiting-room';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The waiting-room page's data, the recall list, and debts by how late they are. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';
const DAY = 86_400_000;
const daysAgo = (n: number) => localDay(new Date(Date.now() - n * DAY));
const daysAhead = (n: number) => localDay(new Date(Date.now() + n * DAY));

async function person(email: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId: 'clinic-a', role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, memberId: member.id };
}

let owner: ClSessionView;
let reception: ClSessionView;
let cashier: ClSessionView;
let doctorId: string;
let counter = 0;

async function patient(name: string, phone = `0770${Math.floor(Math.random() * 1e7)}`) {
  const household = await prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone } });
  return prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId: household.id, name, phone } });
}
async function ticket(patientId: string, day: string, status: 'WAITING' | 'WITH_DOCTOR' | 'TO_PAY' | 'DONE' | 'LEFT') {
  counter += 1;
  return prisma().clTicket.create({ data: { restaurantId: 'clinic-a', day, number: counter, patientId, doctorId, status } });
}
/** A visit that happened `ago` days back. */
async function visitAgo(patientId: string, ago: number) {
  const t = await ticket(patientId, daysAgo(ago), 'DONE');
  return prisma().clVisit.create({ data: { restaurantId: 'clinic-a', ticketId: t.id, patientId, doctorId, createdAt: new Date(Date.now() - ago * DAY) } });
}
/** An open debt of 25,000 due on `dueDay`. */
async function debt(patientId: string, dueDay: string) {
  const t = await ticket(patientId, daysAgo(1), 'DONE');
  return prisma().clBill.create({ data: { restaurantId: 'clinic-a', ticketId: t.id, patientId, doctorId, total: 25000, status: 'DEBT', dueDay } });
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);
const data = <T>(result: { ok: boolean; data?: T }) => result.data as T;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'CAFE', sector: 'CLINIC', status: 'ACTIVE' } });
  await prisma().restaurant.create({ data: { id: 'shop-1', name: 'A Shop', type: 'CAFE', sector: 'RETAIL', status: 'ACTIVE' } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a' } });
  owner = await person('owner@a.test', 'OWNER');
  reception = await person('desk@a.test', 'RECEPTION');
  cashier = await person('till@a.test', 'CASHIER');
  const who = await person('dr@a.test', 'DOCTOR');
  doctorId = (await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: who.memberId } })).id;
});

describe('the waiting-room page', () => {
  it('shows who is being seen and the numbers waiting, and nothing about a patient', async () => {
    const a = await patient('Secret Name', '07701112222');
    const b = await patient('Another Name');
    const c = await patient('Gone Name');
    const d = await patient('Finished Name');
    await ticket(a.id, localDay(new Date()), 'WITH_DOCTOR');
    await ticket(b.id, localDay(new Date()), 'WAITING');
    await ticket(c.id, localDay(new Date()), 'LEFT');
    await ticket(d.id, localDay(new Date()), 'DONE');
    const room = await loadWaitingRoom(prisma(), 'clinic-a');
    expect(room?.clinicName).toBe('Smile Clinic');
    expect(room?.doctors).toHaveLength(1);
    expect(room?.doctors[0]).toMatchObject({ name: 'dr', serving: 1, waiting: [2] });
    const text = JSON.stringify(room);
    for (const secret of ['Secret Name', 'Another Name', 'Gone Name', '07701112222']) expect(text).not.toContain(secret);
  });

  it('answers a business that is not a clinic, or does not exist, as nothing', async () => {
    expect(await loadWaitingRoom(prisma(), 'shop-1')).toBeNull();
    expect(await loadWaitingRoom(prisma(), 'nope')).toBeNull();
  });
});

describe('the recall list', () => {
  it('lists patients last seen long ago, oldest first, and leaves out the recently seen, the never seen and the booked', async () => {
    const old = await patient('Old Visit');
    const older = await patient('Older Visit');
    const recent = await patient('Recent Visit');
    const booked = await patient('Booked Again');
    await patient('Never Seen');
    await visitAgo(old.id, 200);
    await visitAgo(older.id, 400);
    await visitAgo(recent.id, 5);
    await visitAgo(booked.id, 300);
    await prisma().clBooking.create({ data: { restaurantId: 'clinic-a', doctorId, patientId: booked.id, startsAt: new Date(Date.now() + 2 * DAY), endsAt: new Date(Date.now() + 2 * DAY + 900000) } });
    const rows = data<{ name: string; daysAgo: number }[]>(await runClAction(prisma(), reception, recall.listRecall, { days: 180 }));
    expect(rows.map((r) => r.name)).toEqual(['Older Visit', 'Old Visit']);
    expect(rows[0]!.daysAgo).toBeGreaterThanOrEqual(400);
  });

  it('only the desk and a sane window', async () => {
    expect(code(await runClAction(prisma(), cashier, recall.listRecall, { days: 180 }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), owner, recall.listRecall, { days: 3 }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), owner, recall.listRecall, { days: 180 }))).toBe('OK');
  });
});

describe('debts by how late they are', () => {
  it('buckets them, and a debt due today is not late', async () => {
    const p = await patient('Debtor');
    await debt(p.id, daysAhead(0));
    await debt(p.id, daysAgo(10));
    await debt(p.id, daysAgo(45));
    await debt(p.id, daysAgo(100));
    const report = data<{ buckets: { key: string; count: number; balance: number }[]; rows: { daysOverdue: number }[] }>(await runClAction(prisma(), cashier, reports.agedDebts, {}));
    expect(report.buckets.map((b) => [b.key, b.count, b.balance])).toEqual([
      ['NOT_DUE', 1, 25000],
      ['D1_30', 1, 25000],
      ['D31_60', 1, 25000],
      ['D61_PLUS', 1, 25000],
    ]);
    expect(report.rows).toHaveLength(4);
    expect(Math.max(...report.rows.map((r) => r.daysOverdue))).toBeGreaterThanOrEqual(100);
  });

  it('a part payment keeps it a debt, and a new due day can be set, never in the past', async () => {
    const p = await patient('Debtor');
    const bill = await debt(p.id, daysAgo(3));
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 10000 });
    expect(await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } })).toMatchObject({ status: 'DEBT', paid: 10000 });
    expect(code(await runClAction(prisma(), cashier, bills.rescheduleDebt, { billId: bill.id, dueDay: daysAgo(1) }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), cashier, bills.rescheduleDebt, { billId: bill.id, dueDay: daysAhead(14) }))).toBe('OK');
    expect((await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } })).dueDay).toBe(daysAhead(14));
  });

  it('refuses to move a bill that is not a debt', async () => {
    const p = await patient('Debtor');
    const bill = await debt(p.id, daysAhead(2));
    await prisma().clBill.update({ where: { id: bill.id }, data: { status: 'OPEN', dueDay: null } });
    expect(code(await runClAction(prisma(), cashier, bills.rescheduleDebt, { billId: bill.id, dueDay: daysAhead(5) }))).toBe('INVALID');
  });
});
