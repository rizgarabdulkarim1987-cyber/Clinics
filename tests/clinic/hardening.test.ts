import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as board from '@/server/clinic/actions/board';
import * as packages from '@/server/clinic/actions/packages';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { localDay } from '@/server/clinic/time';
import { validateSlug } from '@/server/domain/slug';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Courses: an unpaid course is not spent, one sale is not made twice by a double tap, and the product names are not slugs. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR';

async function person(email: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId: 'clinic-a', role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, space: 'CLINIC' as const, memberId: member.id };
}

let reception: ClSessionView;
let doctor: ClSessionView & { memberId: string };
let doctorId: string;
let patientId: string;
let packageId: string;
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'CAFE', sector: 'CLINIC', status: 'ACTIVE' } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a' } });
  reception = await person('desk@a.test', 'RECEPTION');
  doctor = await person('dr@a.test', 'DOCTOR');
  doctorId = (await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: doctor.memberId } })).id;
  const household = await prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone: '0770' } });
  patientId = (await prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId: household.id, phone: '0770', name: 'Zainab' } })).id;
  packageId = (await prisma().clPackage.create({ data: { restaurantId: 'clinic-a', name: 'Laser x6', sessions: 6, price: 90000 } })).id;
});

describe('selling a course', () => {
  it('refuses the same sale made twice within moments', async () => {
    const input = { patientId, packageId, doctorId };
    expect(code(await runClAction(prisma(), reception, packages.sellPackage, input))).toBe('OK');
    expect(code(await runClAction(prisma(), reception, packages.sellPackage, input))).toBe('INVALID');
    expect(await prisma().clPatientPackage.count()).toBe(1);
  });
});

describe('spending a course', () => {
  async function ownedCourse() {
    const sold = await runClAction(prisma(), reception, packages.sellPackage, { patientId, packageId, doctorId });
    if (!sold.ok) throw new Error('expected a sale');
    return sold.data;
  }
  async function withDoctor() {
    return prisma().clTicket.create({ data: { restaurantId: 'clinic-a', day: localDay(new Date()), number: 50, patientId, doctorId, status: 'WITH_DOCTOR' } });
  }

  it('does not offer or spend a course whose sale bill is still open', async () => {
    const { patientPackageId } = await ownedCourse();
    const ticket = await withDoctor();
    const listed = await runClAction(prisma(), doctor, board.listTicketPackages, { ticketId: ticket.id });
    expect(listed).toMatchObject({ ok: true, data: [] });
    expect(code(await runClAction(prisma(), doctor, board.endVisit, { ticketId: ticket.id, packageId: patientPackageId }))).toBe('INVALID');
    expect((await prisma().clPatientPackage.findUniqueOrThrow({ where: { id: patientPackageId } })).sessionsLeft).toBe(6);
    expect((await prisma().clTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe('WITH_DOCTOR');
  });

  it('spends it once the sale bill is paid or left as a debt', async () => {
    const { billId, patientPackageId } = await ownedCourse();
    await prisma().clBill.update({ where: { id: billId }, data: { status: 'DEBT', dueDay: localDay(new Date()) } });
    const ticket = await withDoctor();
    expect(await runClAction(prisma(), doctor, board.listTicketPackages, { ticketId: ticket.id })).toMatchObject({ ok: true, data: [{ patientPackageId }] });
    expect(code(await runClAction(prisma(), doctor, board.endVisit, { ticketId: ticket.id, packageId: patientPackageId }))).toBe('OK');
    expect((await prisma().clPatientPackage.findUniqueOrThrow({ where: { id: patientPackageId } })).sessionsLeft).toBe(5);
  });
});

describe('product names', () => {
  it('are not offered as business slugs', () => {
    expect(validateSlug('beauty', [])).toEqual({ ok: false, reason: 'RESERVED' });
    expect(validateSlug('clinic', [])).toEqual({ ok: false, reason: 'RESERVED' });
  });
});
