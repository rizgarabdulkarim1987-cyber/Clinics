import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bills from '@/server/clinic/actions/bills';
import * as board from '@/server/clinic/actions/board';
import * as visits from '@/server/clinic/actions/visits';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { localDay } from '@/server/clinic/time';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The doctor's visit note, the bill priced from the doctor's fee list, and the cashier's payments and debts. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';
const SECRET = 'burning pain behind the left eye since monday';

async function person(email: string, restaurantId: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId, role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, space: 'CLINIC' as const, memberId: member.id };
}

async function doctor(email: string, restaurantId = 'clinic-a') {
  const who = await person(email, restaurantId, 'DOCTOR');
  const row = await prisma().clDoctor.create({ data: { restaurantId, memberId: who.memberId } });
  const consult = await prisma().clDoctorFee.create({ data: { restaurantId, doctorId: row.id, label: 'Consultation', amount: 25000, sortOrder: 0 } });
  const scan = await prisma().clDoctorFee.create({ data: { restaurantId, doctorId: row.id, label: 'Scan', amount: 10000, sortOrder: 1 } });
  return { who, row, consult, scan };
}

async function patient(name: string, restaurantId = 'clinic-a') {
  const household = await prisma().clHousehold.create({ data: { restaurantId, phone: `0770${Math.floor(Math.random() * 1e7)}` } });
  return prisma().clPatient.create({ data: { restaurantId, householdId: household.id, name, phone: household.phone } });
}

let number = 0;
async function withDoctor(doctorId: string, patientId: string, restaurantId = 'clinic-a') {
  number += 1;
  return prisma().clTicket.create({ data: { restaurantId, day: localDay(new Date()), number, patientId, doctorId, status: 'WITH_DOCTOR' } });
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);
const data = <T>(result: { ok: boolean; data?: T }) => result.data as T;

let owner: ClSessionView;
let reception: ClSessionView;
let cashier: ClSessionView;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().restaurant.create({ data: { id: 'clinic-b', name: 'Bright Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a' } });
  owner = await person('owner@a.test', 'clinic-a', 'OWNER');
  reception = await person('desk@a.test', 'clinic-a', 'RECEPTION');
  cashier = await person('till@a.test', 'clinic-a', 'CASHIER');
});

/** A finished visit with a bill: one consultation (25,000). */
async function billed(feeKeys: ('consult' | 'scan')[] = ['consult']) {
  const d = await doctor(`d${Math.random().toString(36).slice(2, 7)}@a.test`);
  const p = await patient('Ali');
  const ticket = await withDoctor(d.row.id, p.id);
  const feeIds = feeKeys.map((k) => (k === 'consult' ? d.consult.id : d.scan.id));
  const ended = await runClAction(prisma(), d.who, board.endVisit, { ticketId: ticket.id, complaint: 'Headache', note: SECRET, feeIds });
  expect(code(ended)).toBe('OK');
  const bill = await prisma().clBill.findFirstOrThrow({ where: { ticketId: ticket.id } });
  return { d, p, ticket, bill };
}

describe('ending a visit', () => {
  it('writes the note and a bill priced from the doctor fee list, never from the client', async () => {
    const { d, ticket, bill } = await billed(['consult', 'scan']);
    expect(bill.total).toBe(35000);
    expect(bill.status).toBe('OPEN');
    expect((await prisma().clBillLine.findMany({ where: { billId: bill.id } })).map((l) => l.label).sort()).toEqual(['Consultation', 'Scan']);
    expect((await prisma().clTicket.findFirstOrThrow({ where: { id: ticket.id } })).status).toBe('TO_PAY');
    const visit = await prisma().clVisit.findFirstOrThrow({ where: { ticketId: ticket.id } });
    expect(visit.doctorId).toBe(d.row.id);
    expect(visit.note).toBe(SECRET);
  });

  it('refuses a fee that is not on this doctor\'s list', async () => {
    const d = await doctor('d1@a.test');
    const other = await doctor('d2@a.test');
    const ticket = await withDoctor(d.row.id, (await patient('P')).id);
    const result = await runClAction(prisma(), d.who, board.endVisit, { ticketId: ticket.id, feeIds: [other.consult.id] });
    expect(code(result)).toBe('NOT_FOUND');
    expect((await prisma().clTicket.findFirstOrThrow({ where: { id: ticket.id } })).status).toBe('WITH_DOCTOR');
  });

  it('only the doctor writes a note; the desk can end a visit without one', async () => {
    const d = await doctor('d@a.test');
    const ticket = await withDoctor(d.row.id, (await patient('P')).id);
    expect(code(await runClAction(prisma(), reception, board.endVisit, { ticketId: ticket.id, note: 'x' }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), reception, board.endVisit, { ticketId: ticket.id, feeIds: [d.consult.id] }))).toBe('OK');
  });

  it('a visit with nothing to charge closes by itself', async () => {
    const d = await doctor('d@a.test');
    const ticket = await withDoctor(d.row.id, (await patient('P')).id);
    expect(code(await runClAction(prisma(), d.who, board.endVisit, { ticketId: ticket.id }))).toBe('OK');
    expect((await prisma().clTicket.findFirstOrThrow({ where: { id: ticket.id } })).status).toBe('DONE');
    expect((await prisma().clBill.findFirstOrThrow({ where: { ticketId: ticket.id } })).status).toBe('PAID');
  });

  it('ending twice leaves one visit and one bill', async () => {
    const { d, ticket } = await billed();
    expect(code(await runClAction(prisma(), d.who, board.endVisit, { ticketId: ticket.id, feeIds: [d.consult.id] }))).toBe('INVALID');
    expect(await prisma().clVisit.count({ where: { ticketId: ticket.id } })).toBe(1);
    expect(await prisma().clBill.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it('puts no note text in any audit row', async () => {
    await billed();
    const rows = await prisma().auditLog.findMany({});
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });
});

describe('who reads a note', () => {
  it('the doctor who wrote it reads it, and the read is logged by id', async () => {
    const { d, ticket } = await billed();
    const result = await runClAction(prisma(), d.who, visits.getVisit, { ticketId: ticket.id });
    expect(data<{ note: string }>(result).note).toBe(SECRET);
    const rows = await prisma().auditLog.findMany({ where: { action: 'clinic.visit_read' } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });

  it('another doctor gets nothing unless the clinic shares notes', async () => {
    const { ticket, p } = await billed();
    const other = await doctor('other@a.test');
    expect(code(await runClAction(prisma(), other.who, visits.getVisit, { ticketId: ticket.id }))).toBe('NOT_FOUND');
    expect(data<unknown[]>(await runClAction(prisma(), other.who, visits.listPatientVisits, { patientId: p.id }))).toHaveLength(0);
    await prisma().clSettings.updateMany({ where: { restaurantId: 'clinic-a' }, data: { sharePrivateNotes: true } });
    expect(code(await runClAction(prisma(), other.who, visits.getVisit, { ticketId: ticket.id }))).toBe('OK');
    expect(data<unknown[]>(await runClAction(prisma(), other.who, visits.listPatientVisits, { patientId: p.id }))).toHaveLength(1);
  });

  it('the owner, the receptionist and the cashier never read a note', async () => {
    const { ticket } = await billed();
    for (const who of [owner, reception, cashier]) expect(code(await runClAction(prisma(), who, visits.getVisit, { ticketId: ticket.id }))).toBe('FORBIDDEN');
  });

  it('the cashier list carries no note or complaint', async () => {
    await billed();
    const text = JSON.stringify(await runClAction(prisma(), cashier, bills.listBills, {}));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('Headache');
  });
});

describe('the bill lines', () => {
  it('adds and removes a line while the bill is open, keeping the total', async () => {
    const { bill } = await billed();
    expect(code(await runClAction(prisma(), cashier, bills.addBillLine, { billId: bill.id, label: 'Gauze', amount: 2000 }))).toBe('OK');
    expect((await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } })).total).toBe(27000);
    const line = await prisma().clBillLine.findFirstOrThrow({ where: { billId: bill.id, label: 'Gauze' } });
    expect(code(await runClAction(prisma(), cashier, bills.removeBillLine, { lineId: line.id }))).toBe('OK');
    expect((await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } })).total).toBe(25000);
  });

  it('refuses edits and bad amounts', async () => {
    const { bill } = await billed();
    expect(code(await runClAction(prisma(), cashier, bills.addBillLine, { billId: bill.id, label: 'x', amount: 0 }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), cashier, bills.addBillLine, { billId: bill.id, label: 'x', amount: 1.5 }))).toBe('INVALID');
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 25000 });
    expect(code(await runClAction(prisma(), cashier, bills.addBillLine, { billId: bill.id, label: 'Late', amount: 1000 }))).toBe('INVALID');
  });
});

describe('taking payments', () => {
  it('a full dinar payment settles the bill and the token', async () => {
    const { bill, ticket } = await billed();
    const result = await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 25000 });
    expect(data<{ changeIqd: number }>(result).changeIqd).toBe(0);
    const row = await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } });
    expect(row.status).toBe('PAID');
    expect(row.paid).toBe(25000);
    expect((await prisma().clTicket.findFirstOrThrow({ where: { id: ticket.id } })).status).toBe('DONE');
  });

  it('a part payment leaves the bill open; an overpayment is change in dinar', async () => {
    const { bill } = await billed();
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 10000 });
    expect((await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } })).status).toBe('OPEN');
    const result = await runClAction(prisma(), reception, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 20000 });
    expect(data<{ changeIqd: number }>(result).changeIqd).toBe(5000);
    const row = await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } });
    expect(row.paid).toBe(25000);
    expect(row.status).toBe('PAID');
  });

  it('dollars convert at the rate of that moment and change comes back in dinar', async () => {
    const { bill } = await billed();
    await runClAction(prisma(), owner, bills.saveRate, { usdRate: 1500 });
    const result = await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'USD', amount: 2000 });
    expect(data<{ changeIqd: number }>(result).changeIqd).toBe(5000);
    await runClAction(prisma(), owner, bills.saveRate, { usdRate: 1400 });
    const payment = await prisma().clPayment.findFirstOrThrow({ where: { billId: bill.id } });
    expect(payment).toMatchObject({ currency: 'USD', tendered: 2000, rate: 1500, appliedIqd: 25000, changeIqd: 5000 });
  });

  it('refuses a payment on a settled bill, a zero amount and another clinic\'s bill', async () => {
    const { bill } = await billed();
    expect(code(await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 0 }))).toBe('INVALID');
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 25000 });
    expect(code(await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 1000 }))).toBe('INVALID');
    const b = await person('till@b.test', 'clinic-b', 'CASHIER');
    expect(code(await runClAction(prisma(), b, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 1000 }))).toBe('NOT_FOUND');
  });

  it('two payments at once never take a bill past paid', async () => {
    const { bill } = await billed();
    const attempts = await Promise.all([1, 2, 3].map(() => runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 25000 })));
    expect(attempts.filter((a) => a.ok)).toHaveLength(1);
    const row = await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } });
    expect(row.paid).toBe(25000);
    const applied = await prisma().clPayment.aggregate({ where: { billId: bill.id }, _sum: { appliedIqd: true } });
    expect(applied._sum.appliedIqd).toBe(25000);
  });

  it('the doctor cannot take payments or see bills', async () => {
    const { d, bill } = await billed();
    expect(code(await runClAction(prisma(), d.who, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 1000 }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), d.who, bills.listBills, {}))).toBe('FORBIDDEN');
  });
});

describe('debts', () => {
  const later = () => localDay(new Date(Date.now() + 3 * 86400000));

  it('leaves the balance as a debt with a due day, closes the token, and a later payment settles it', async () => {
    const { bill, ticket } = await billed();
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 10000 });
    expect(code(await runClAction(prisma(), cashier, bills.leaveAsDebt, { billId: bill.id, dueDay: later() }))).toBe('OK');
    const row = await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } });
    expect(row).toMatchObject({ status: 'DEBT', dueDay: later(), paid: 10000 });
    expect((await prisma().clTicket.findFirstOrThrow({ where: { id: ticket.id } })).status).toBe('DONE');
    expect(code(await runClAction(prisma(), cashier, bills.addBillLine, { billId: bill.id, label: 'x', amount: 1000 }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 15000 }))).toBe('OK');
    expect((await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } })).status).toBe('PAID');
  });

  it('needs a real future-or-today day and a balance', async () => {
    const { bill } = await billed();
    for (const dueDay of ['2020-01-01', 'soon', '2026-13-40']) expect(code(await runClAction(prisma(), cashier, bills.leaveAsDebt, { billId: bill.id, dueDay }))).toBe('INVALID');
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 25000 });
    expect(code(await runClAction(prisma(), cashier, bills.leaveAsDebt, { billId: bill.id, dueDay: later() }))).toBe('INVALID');
  });

  it('lists debts for the till', async () => {
    const { bill } = await billed();
    await runClAction(prisma(), cashier, bills.leaveAsDebt, { billId: bill.id, dueDay: later() });
    const list = data<{ billId: string; balance: number; status: string }[]>(await runClAction(prisma(), cashier, bills.listBills, { status: 'DEBT' }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ billId: bill.id, balance: 25000, status: 'DEBT' });
  });
});

describe('the dollar rate', () => {
  it('only the owner sets it, within a sane range', async () => {
    expect(code(await runClAction(prisma(), owner, bills.saveRate, { usdRate: 1460 }))).toBe('OK');
    expect(data<{ usdRate: number }>(await runClAction(prisma(), cashier, bills.getRate, {})).usdRate).toBe(1460);
    expect(code(await runClAction(prisma(), cashier, bills.saveRate, { usdRate: 1460 }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), owner, bills.saveRate, { usdRate: 0 }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), owner, bills.saveRate, { usdRate: 10 }))).toBe('INVALID');
  });
});
