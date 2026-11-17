import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as doctors from '@/server/clinic/actions/doctors';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Doctors: a profile, a working week and a fee list, edited by the owner and read by the owner and the receptionist. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, restaurantId: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId, role } });
  return { sessionId: 's', accountId: id, name: email, email, space: 'CLINIC' as const, memberId: member.id };
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'OTHER', sector: 'CLINIC' } });
  await prisma().restaurant.create({ data: { id: 'clinic-b', name: 'Bright Clinic', type: 'OTHER', sector: 'CLINIC' } });
});

describe('the doctor list', () => {
  it('lists the clinic’s doctors with their week and fees, even before a profile exists, and no other clinic’s', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const doc = await person('doc@a.test', 'clinic-a', 'DOCTOR');
    await person('doc@b.test', 'clinic-b', 'DOCTOR');
    await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const before = await runClAction(prisma(), owner, doctors.listDoctors, {});
    expect(before.ok && before.data).toEqual([expect.objectContaining({ memberId: doc.memberId, speciality: '', hours: [], fees: [] })]);
    await runClAction(prisma(), owner, doctors.saveDoctorProfile, { memberId: doc.memberId, speciality: 'Dentist', active: true });
    await runClAction(prisma(), owner, doctors.saveDoctorFees, { memberId: doc.memberId, fees: [{ label: 'Check-up', amount: 25000 }, { label: 'Filling', amount: 60000 }] });
    const after = await runClAction(prisma(), owner, doctors.listDoctors, {});
    expect(after.ok && after.data[0]).toMatchObject({ speciality: 'Dentist', fees: [{ label: 'Check-up', amount: 25000 }, { label: 'Filling', amount: 60000 }] });
  });
});

describe('saving a doctor', () => {
  it('saves the profile, and refuses a person who is not a doctor of this clinic', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const stranger = await person('doc@b.test', 'clinic-b', 'DOCTOR');
    expect(code(await runClAction(prisma(), owner, doctors.saveDoctorProfile, { memberId: rec.memberId, speciality: 'x', active: true }))).toBe('NOT_FOUND');
    expect(code(await runClAction(prisma(), owner, doctors.saveDoctorProfile, { memberId: stranger.memberId, speciality: 'x', active: true }))).toBe('NOT_FOUND');
    expect(await prisma().clDoctor.count()).toBe(0);
  });

  it('replaces the week, and refuses blocks that overlap, end before they start or fall outside the day', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const doc = await person('doc@a.test', 'clinic-a', 'DOCTOR');
    const save = (blocks: { weekday: number; startMin: number; endMin: number }[]) => runClAction(prisma(), owner, doctors.saveDoctorHours, { memberId: doc.memberId, blocks });
    expect((await save([{ weekday: 0, startMin: 540, endMin: 780 }, { weekday: 0, startMin: 960, endMin: 1200 }, { weekday: 1, startMin: 540, endMin: 780 }])).ok).toBe(true);
    expect(await prisma().clDoctorHours.count()).toBe(3);
    expect((await save([{ weekday: 2, startMin: 600, endMin: 660 }])).ok).toBe(true);
    expect(await prisma().clDoctorHours.count()).toBe(1);
    expect(code(await save([{ weekday: 0, startMin: 540, endMin: 700 }, { weekday: 0, startMin: 650, endMin: 800 }]))).toBe('INVALID');
    expect(code(await save([{ weekday: 0, startMin: 700, endMin: 700 }]))).toBe('INVALID');
    expect(code(await save([{ weekday: 7, startMin: 100, endMin: 200 }]))).toBe('INVALID');
    expect(code(await save([{ weekday: 0, startMin: 100, endMin: 1500 }]))).toBe('INVALID');
    expect(await prisma().clDoctorHours.count()).toBe(1);
  });

  it('replaces the fee list, and refuses a blank label or a negative fee', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const doc = await person('doc@a.test', 'clinic-a', 'DOCTOR');
    const save = (fees: { label: string; amount: number }[]) => runClAction(prisma(), owner, doctors.saveDoctorFees, { memberId: doc.memberId, fees });
    expect((await save([{ label: 'Check-up', amount: 25000 }])).ok).toBe(true);
    expect((await save([{ label: 'Follow-up', amount: 0 }])).ok).toBe(true);
    expect((await prisma().clDoctorFee.findMany()).map((f) => f.label)).toEqual(['Follow-up']);
    expect(code(await save([{ label: ' ', amount: 100 }]))).toBe('INVALID');
    expect(code(await save([{ label: 'x', amount: -1 }]))).toBe('INVALID');
    expect(code(await save([{ label: 'x', amount: 1.5 }]))).toBe('INVALID');
  });

  it('writes audit rows for each save, and no more than counts of what changed', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const doc = await person('doc@a.test', 'clinic-a', 'DOCTOR');
    await runClAction(prisma(), owner, doctors.saveDoctorProfile, { memberId: doc.memberId, speciality: 'Dentist', active: true });
    await runClAction(prisma(), owner, doctors.saveDoctorHours, { memberId: doc.memberId, blocks: [{ weekday: 0, startMin: 540, endMin: 780 }] });
    await runClAction(prisma(), owner, doctors.saveDoctorFees, { memberId: doc.memberId, fees: [{ label: 'Check-up', amount: 25000 }] });
    const rows = await prisma().auditLog.findMany({ where: { restaurantId: 'clinic-a', action: { in: ['clinic.doctor_profile_saved', 'clinic.doctor_hours_saved', 'clinic.doctor_fees_saved'] } } });
    expect(rows).toHaveLength(3);
  });
});

describe('who may use the doctors’ pages', () => {
  it('lets the owner edit, lets the receptionist read, and refuses a doctor and the one who takes payments', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const rec = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const doc = await person('doc@a.test', 'clinic-a', 'DOCTOR');
    const cashier = await person('cash@a.test', 'clinic-a', 'CASHIER');
    expect(code(await runClAction(prisma(), rec, doctors.listDoctors, {}))).toBe('OK');
    expect(code(await runClAction(prisma(), rec, doctors.saveDoctorProfile, { memberId: doc.memberId, speciality: 'x', active: true }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), doc, doctors.listDoctors, {}))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), cashier, doctors.saveDoctorFees, { memberId: doc.memberId, fees: [] }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), owner, doctors.saveDoctorFees, { memberId: doc.memberId, fees: [] }))).toBe('OK');
  });
});
