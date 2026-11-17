import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bills from '@/server/clinic/actions/bills';
import * as board from '@/server/clinic/actions/board';
import * as loyalty from '@/server/clinic/actions/loyalty';
import * as patients from '@/server/clinic/actions/patients';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { localDay } from '@/server/clinic/time';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The household stamp card, the referral bonus, and spending a full card at the cashier. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId: 'clinic-a', role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, memberId: member.id };
}

let owner: ClSessionView;
let cashier: ClSessionView;
let reception: ClSessionView;
let dr: Awaited<ReturnType<typeof makeDoctor>>;

async function makeDoctor() {
  const who = await person('dr@a.test', 'DOCTOR');
  const row = await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: who.memberId } });
  const fee = await prisma().clDoctorFee.create({ data: { restaurantId: 'clinic-a', doctorId: row.id, label: 'Consultation', amount: 25000 } });
  return { who, row, fee };
}

async function household() {
  return prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone: `0770${Math.floor(Math.random() * 1e7)}` } });
}
async function patientIn(householdId: string, name: string, referredById?: string) {
  const h = await prisma().clHousehold.findFirstOrThrow({ where: { id: householdId } });
  return prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId, name, phone: h.phone, ...(referredById ? { referredById } : {}) } });
}

let number = 0;
/** A finished visit for this patient: a 25,000 bill, still open. */
async function openBill(patientId: string, withFee = true) {
  number += 1;
  const ticket = await prisma().clTicket.create({ data: { restaurantId: 'clinic-a', day: localDay(new Date()), number, patientId, doctorId: dr.row.id, status: 'WITH_DOCTOR' } });
  await runClAction(prisma(), dr.who, board.endVisit, { ticketId: ticket.id, ...(withFee ? { feeIds: [dr.fee.id] } : {}) });
  return prisma().clBill.findFirstOrThrow({ where: { ticketId: ticket.id } });
}
const payAll = (billId: string) => runClAction(prisma(), cashier, bills.takePayment, { billId, currency: 'IQD', amount: 25000 });
const stamps = async (householdId: string) => (await prisma().clLoyaltyEntry.aggregate({ where: { householdId }, _sum: { delta: true } }))._sum.delta ?? 0;
const seed = (householdId: string, delta: number, key = `seed:${Math.random()}`) => prisma().clLoyaltyEntry.create({ data: { restaurantId: 'clinic-a', householdId, kind: 'VISIT', delta, refKey: key } });
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);
const data = <T>(result: { ok: boolean; data?: T }) => result.data as T;
const turnOn = (patch: Partial<{ every: number; rewardIqd: number; referralStamps: number }> = {}) =>
  runClAction(prisma(), owner, loyalty.saveLoyaltySettings, { enabled: true, every: 5, rewardIqd: 5000, referralStamps: 1, ...patch });

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a' } });
  owner = await person('owner@a.test', 'OWNER');
  cashier = await person('till@a.test', 'CASHIER');
  reception = await person('desk@a.test', 'RECEPTION');
  dr = await makeDoctor();
});

describe('the settings', () => {
  it('are off by default, owner-only, and within range', async () => {
    const start = data<{ enabled: boolean; every: number }>(await runClAction(prisma(), owner, loyalty.getLoyaltySettings, {}));
    expect(start).toMatchObject({ enabled: false, every: 5 });
    expect(code(await turnOn())).toBe('OK');
    expect(code(await runClAction(prisma(), cashier, loyalty.saveLoyaltySettings, { enabled: true, every: 5, rewardIqd: 5000, referralStamps: 1 }))).toBe('FORBIDDEN');
    expect(code(await turnOn({ every: 0 }))).toBe('INVALID');
    expect(code(await turnOn({ referralStamps: 11 }))).toBe('INVALID');
    expect(code(await turnOn({ rewardIqd: -1 }))).toBe('INVALID');
  });
});

describe('earning stamps', () => {
  it('earns nothing while it is off', async () => {
    const h = await household();
    const bill = await openBill((await patientIn(h.id, 'A')).id);
    await payAll(bill.id);
    expect(await stamps(h.id)).toBe(0);
  });

  it('a bill paid in two parts stamps once, when it is fully paid; a bill with nothing to pay stamps nothing', async () => {
    await turnOn();
    const h = await household();
    const p = await patientIn(h.id, 'A');
    const bill = await openBill(p.id);
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 10000 });
    expect(await stamps(h.id)).toBe(0);
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 15000 });
    expect(await stamps(h.id)).toBe(1);
    await openBill(p.id, false);
    expect(await stamps(h.id)).toBe(1);
  });

  it('is shared by the household: a sibling sees the same card', async () => {
    await turnOn();
    const h = await household();
    const a = await patientIn(h.id, 'A');
    const b = await patientIn(h.id, 'B');
    await payAll((await openBill(a.id)).id);
    const card = data<{ stamps: number }>(await runClAction(prisma(), cashier, loyalty.getHouseholdCard, { patientId: b.id }));
    expect(card.stamps).toBe(1);
  });
});

describe('the referral bonus', () => {
  it('pays the referrer\'s household once, on the referred patient\'s first paid bill', async () => {
    await turnOn({ referralStamps: 2 });
    const hA = await household();
    const hB = await household();
    const a = await patientIn(hA.id, 'A');
    const b = await patientIn(hB.id, 'B', a.id);
    await payAll((await openBill(b.id)).id);
    expect(await stamps(hA.id)).toBe(2);
    expect(await stamps(hB.id)).toBe(1);
    await payAll((await openBill(b.id)).id);
    expect(await stamps(hA.id)).toBe(2);
  });

  it('pays nothing to the same household', async () => {
    await turnOn();
    const h = await household();
    const a = await patientIn(h.id, 'A');
    const b = await patientIn(h.id, 'B', a.id);
    await payAll((await openBill(b.id)).id);
    expect(await stamps(h.id)).toBe(1);
  });

  it('is set when a patient is created with the referrer\'s phone', async () => {
    const referrer = await runClAction(prisma(), reception, patients.createPatient, { name: 'Referrer', phone: '07701234567' });
    expect(code(referrer)).toBe('OK');
    const made = await runClAction(prisma(), reception, patients.createPatient, { name: 'New', phone: '07709876543', referredByPhone: '07701234567' });
    expect(code(made)).toBe('OK');
    const row = await prisma().clPatient.findFirstOrThrow({ where: { name: 'New' } });
    const ref = await prisma().clPatient.findFirstOrThrow({ where: { name: 'Referrer' } });
    expect(row.referredById).toBe(ref.id);
    expect(code(await runClAction(prisma(), reception, patients.createPatient, { name: 'Lost', phone: '07705555555', referredByPhone: '07700000000' }))).toBe('INVALID');
  });
});

describe('spending a full card', () => {
  it('takes the stamps, adds a negative line, and lowers the bill', async () => {
    await turnOn();
    const h = await household();
    await seed(h.id, 5);
    const bill = await openBill((await patientIn(h.id, 'A')).id);
    expect(code(await runClAction(prisma(), cashier, loyalty.redeemReward, { billId: bill.id }))).toBe('OK');
    expect(await stamps(h.id)).toBe(0);
    const row = await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } });
    expect(row.total).toBe(20000);
    const line = await prisma().clBillLine.findFirstOrThrow({ where: { billId: bill.id, amount: { lt: 0 } } });
    expect(line.amount).toBe(-5000);
    expect(code(await runClAction(prisma(), cashier, bills.removeBillLine, { lineId: line.id }))).toBe('INVALID');
  });

  it('refuses without a full card, twice on one bill, and while loyalty is off', async () => {
    const h = await household();
    await seed(h.id, 5);
    const bill = await openBill((await patientIn(h.id, 'A')).id);
    expect(code(await runClAction(prisma(), cashier, loyalty.redeemReward, { billId: bill.id }))).toBe('INVALID');
    await turnOn();
    await seed(h.id, 5);
    expect(code(await runClAction(prisma(), cashier, loyalty.redeemReward, { billId: bill.id }))).toBe('OK');
    expect(code(await runClAction(prisma(), cashier, loyalty.redeemReward, { billId: bill.id }))).toBe('INVALID');
    const poor = await household();
    const other = await openBill((await patientIn(poor.id, 'B')).id);
    expect(code(await runClAction(prisma(), cashier, loyalty.redeemReward, { billId: other.id }))).toBe('INVALID');
  });

  it('never takes a bill below what was already paid, and a bill the reward settles is closed', async () => {
    await turnOn();
    const h = await household();
    await seed(h.id, 5);
    const bill = await openBill((await patientIn(h.id, 'A')).id);
    await runClAction(prisma(), cashier, bills.takePayment, { billId: bill.id, currency: 'IQD', amount: 22000 });
    expect(code(await runClAction(prisma(), cashier, loyalty.redeemReward, { billId: bill.id }))).toBe('OK');
    const row = await prisma().clBill.findFirstOrThrow({ where: { id: bill.id } });
    expect(row).toMatchObject({ total: 22000, paid: 22000, status: 'PAID' });
    expect((await prisma().clTicket.findFirstOrThrow({ where: { id: row.ticketId } })).status).toBe('DONE');
  });

  it('two redeems at once never spend the same stamps', async () => {
    await turnOn();
    const h = await household();
    await seed(h.id, 5);
    const a = await openBill((await patientIn(h.id, 'A')).id);
    const b = await openBill((await patientIn(h.id, 'B')).id);
    const results = await Promise.all([a, b].map((bill) => runClAction(prisma(), cashier, loyalty.redeemReward, { billId: bill.id })));
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(1);
    expect(await stamps(h.id)).toBeGreaterThanOrEqual(0);
  });

  it('the doctor cannot redeem or read a card', async () => {
    const h = await household();
    const p = await patientIn(h.id, 'A');
    const bill = await openBill(p.id);
    expect(code(await runClAction(prisma(), dr.who, loyalty.redeemReward, { billId: bill.id }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), dr.who, loyalty.getHouseholdCard, { patientId: p.id }))).toBe('FORBIDDEN');
  });
});
