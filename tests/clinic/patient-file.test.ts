import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as files from '@/server/clinic/actions/patient-file';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { fromLocal, localDay } from '@/server/clinic/time';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The desk's patient file has money and appointments, never clinical text; the alert is the doctor's alone. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
const DAY = 86_400_000;
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, role: Role, space: 'CLINIC' | 'BEAUTY' = 'CLINIC', restaurantId = 'clinic-a'): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD, space });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId, role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, space, memberId: member.id };
}

let owner: ClSessionView;
let reception: ClSessionView;
let cashier: ClSessionView;
let doctor: ClSessionView & { memberId: string };
let doctorId: string;
let patientId: string;
let counter = 0;
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'CAFE', sector: 'CLINIC', status: 'ACTIVE' } });
  await prisma().restaurant.create({ data: { id: 'glow', name: 'Glow', type: 'CAFE', sector: 'CLINIC', status: 'ACTIVE', clSettings: { create: { kind: 'BEAUTY' } } } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a', loyaltyEnabled: true } });
  owner = await person('owner@a.test', 'OWNER');
  reception = await person('desk@a.test', 'RECEPTION');
  cashier = await person('till@a.test', 'CASHIER');
  doctor = await person('dr@a.test', 'DOCTOR');
  doctorId = (await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: doctor.memberId } })).id;
  const household = await prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone: '0770' } });
  patientId = (await prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId: household.id, name: 'Zainab', phone: '0770' } })).id;
});

async function visit(ago: number, total: number, paid: number, status: 'PAID' | 'DEBT' | 'OPEN') {
  counter += 1;
  const day = localDay(new Date(Date.now() - ago * DAY));
  const ticket = await prisma().clTicket.create({ data: { restaurantId: 'clinic-a', day, number: counter, patientId, doctorId, status: 'DONE' } });
  await prisma().clVisit.create({ data: { restaurantId: 'clinic-a', ticketId: ticket.id, patientId, doctorId, complaint: 'SECRET complaint', note: 'SECRET note' } });
  return prisma().clBill.create({ data: { restaurantId: 'clinic-a', ticketId: ticket.id, patientId, doctorId, total, paid, status, dueDay: status === 'DEBT' ? localDay(new Date()) : null } });
}

describe('the patient file', () => {
  it('gathers visits with money, what is coming, courses, debt and stamps, and no clinical text', async () => {
    await visit(10, 25000, 25000, 'PAID');
    await visit(3, 40000, 15000, 'DEBT');
    await prisma().clBooking.create({ data: { restaurantId: 'clinic-a', doctorId, patientId, startsAt: fromLocal(localDay(new Date(Date.now() + 2 * DAY)), 600), endsAt: fromLocal(localDay(new Date(Date.now() + 2 * DAY)), 615) } });
    await prisma().clBooking.create({ data: { restaurantId: 'clinic-a', doctorId, patientId, startsAt: new Date(Date.now() - 5 * DAY), endsAt: new Date(Date.now() - 5 * DAY + 900_000), status: 'NO_SHOW' } });
    const pack = await prisma().clPackage.create({ data: { restaurantId: 'clinic-a', name: 'Laser x6', sessions: 6, price: 100000 } });
    await prisma().clPatientPackage.create({ data: { restaurantId: 'clinic-a', packageId: pack.id, patientId, name: 'Laser x6', sessionsTotal: 6, sessionsLeft: 4 } });
    const patient = await prisma().clPatient.findUniqueOrThrow({ where: { id: patientId } });
    await prisma().clLoyaltyEntry.create({ data: { restaurantId: 'clinic-a', householdId: patient.householdId, kind: 'VISIT', delta: 3, refKey: 'k1' } });

    const result = await runClAction(prisma(), reception, files.getPatientFile, { patientId });
    if (!result.ok) throw new Error('expected a file');
    expect(result.data.visits.map((v) => [v.total, v.paid, v.status])).toEqual([[40000, 15000, 'DEBT'], [25000, 25000, 'PAID']]);
    expect(result.data.upcoming).toHaveLength(1);
    expect(result.data.packages).toEqual([{ name: 'Laser x6', sessionsLeft: 4 }]);
    expect(result.data.debt).toBe(25000);
    expect(result.data.stamps).toBe(3);
    expect(result.data.noShows).toBe(1);
    expect(JSON.stringify(result.data)).not.toContain('SECRET');
  });

  it('is for the owner and the desk, and another clinic’s patient is not found', async () => {
    expect(code(await runClAction(prisma(), owner, files.getPatientFile, { patientId }))).toBe('OK');
    expect(code(await runClAction(prisma(), cashier, files.getPatientFile, { patientId }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), doctor, files.getPatientFile, { patientId }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), reception, files.getPatientFile, { patientId: 'nobody' }))).toBe('NOT_FOUND');
  });
});

describe('the clinical alert', () => {
  it('lets a doctor write and read it, and nobody else', async () => {
    expect(code(await runClAction(prisma(), doctor, files.savePatientAlert, { patientId, text: 'Allergic to penicillin' }))).toBe('OK');
    expect(await runClAction(prisma(), doctor, files.getPatientAlert, { patientId })).toMatchObject({ ok: true, data: { text: 'Allergic to penicillin' } });
    for (const who of [owner, reception, cashier]) {
      expect(code(await runClAction(prisma(), who, files.getPatientAlert, { patientId }))).toBe('FORBIDDEN');
      expect(code(await runClAction(prisma(), who, files.savePatientAlert, { patientId, text: 'x' }))).toBe('FORBIDDEN');
    }
  });

  it('replaces the text, clears it when emptied, and keeps the words out of the audit log', async () => {
    await runClAction(prisma(), doctor, files.savePatientAlert, { patientId, text: 'Asthma' });
    await runClAction(prisma(), doctor, files.savePatientAlert, { patientId, text: 'Asthma and latex allergy' });
    expect(await prisma().clPatientAlert.count()).toBe(1);
    const audits = await prisma().auditLog.findMany({ where: { entityType: 'ClPatient' } });
    expect(JSON.stringify(audits)).not.toContain('latex');
    await runClAction(prisma(), doctor, files.savePatientAlert, { patientId, text: '  ' });
    expect(await prisma().clPatientAlert.count()).toBe(0);
    expect(await runClAction(prisma(), doctor, files.getPatientAlert, { patientId })).toMatchObject({ ok: true, data: { text: '' } });
  });

  it('is refused in a beauty centre, which keeps no clinical text', async () => {
    const beautyDoctor = await person('stylist@b.test', 'DOCTOR', 'BEAUTY', 'glow');
    const bDoctorId = (await prisma().clDoctor.create({ data: { restaurantId: 'glow', memberId: beautyDoctor.memberId } })).id;
    expect(bDoctorId).toBeTruthy();
    const household = await prisma().clHousehold.create({ data: { restaurantId: 'glow', phone: '0771' } });
    const client = await prisma().clPatient.create({ data: { restaurantId: 'glow', householdId: household.id, name: 'Lina', phone: '0771' } });
    expect(code(await runClAction(prisma(), beautyDoctor, files.savePatientAlert, { patientId: client.id, text: 'x' }))).toBe('FORBIDDEN');
  });
});
