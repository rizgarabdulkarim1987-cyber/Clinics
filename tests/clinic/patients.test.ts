import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as patients from '@/server/clinic/actions/patients';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { normalizePhone } from '@/server/clinic/phone';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The clinic's one patient file: households by phone, search, and who may open it. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, restaurantId: string, role: Role): Promise<ClSessionView> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  await prisma().clMember.create({ data: { accountId: id, restaurantId, role } });
  return { sessionId: 's', accountId: id, name: email, email };
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

describe('phone numbers', () => {
  it('keeps digits only and writes the country code as a leading 0', () => {
    expect(normalizePhone('+964 770 123 4567')).toBe('07701234567');
    expect(normalizePhone('00964-770-123-4567')).toBe('07701234567');
    expect(normalizePhone('964 770 123 4567')).toBe('07701234567');
    expect(normalizePhone('0770 123 4567')).toBe('07701234567');
    expect(normalizePhone('٠٧٧٠١٢٣٤٥٦٧')).toBe('07701234567');
  });
});

describe('creating a patient', () => {
  it('puts people with one phone into one household, and keeps households apart per clinic', async () => {
    const a = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const b = await person('rec@b.test', 'clinic-b', 'RECEPTION');
    const one = await runClAction(prisma(), a, patients.createPatient, { name: 'Sara Ali', phone: '0770 123 4567' });
    const two = await runClAction(prisma(), a, patients.createPatient, { name: 'Omar Ali', phone: '+964 770 123 4567', birthYear: 2015 });
    const other = await runClAction(prisma(), b, patients.createPatient, { name: 'Sara Ali', phone: '0770 123 4567' });
    expect(one.ok && two.ok && other.ok).toBe(true);
    const rows = await prisma().clPatient.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(3);
    expect(rows[0]!.householdId).toBe(rows[1]!.householdId);
    expect(rows[2]!.householdId).not.toBe(rows[0]!.householdId);
    expect(rows[1]!.phone).toBe('07701234567');
  });

  it('audits the file by its id alone, never a name or a phone', async () => {
    const a = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    await runClAction(prisma(), a, patients.createPatient, { name: 'Sara Ali', phone: '07701234567' });
    const rows = await prisma().auditLog.findMany({ where: { restaurantId: 'clinic-a', action: 'clinic.patient_created' } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/Sara|0770|1234567/);
  });

  it('refuses a name that is empty, a phone that is not a number and a birth year that cannot be', async () => {
    const a = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    expect(code(await runClAction(prisma(), a, patients.createPatient, { name: '  ', phone: '07701234567' }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), a, patients.createPatient, { name: 'Sara', phone: 'abc' }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), a, patients.createPatient, { name: 'Sara', phone: '07701234567', birthYear: 1800 }))).toBe('INVALID');
  });
});

describe('finding and changing a patient', () => {
  it('searches by name or by phone, in this clinic only', async () => {
    const a = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const b = await person('rec@b.test', 'clinic-b', 'RECEPTION');
    await runClAction(prisma(), a, patients.createPatient, { name: 'Sara Ali', phone: '07701234567' });
    await runClAction(prisma(), a, patients.createPatient, { name: 'Omar Hassan', phone: '07509998888' });
    await runClAction(prisma(), b, patients.createPatient, { name: 'Sara Ahmed', phone: '07701234567' });
    const byName = await runClAction(prisma(), a, patients.searchPatients, { query: 'sara' });
    const byPhone = await runClAction(prisma(), a, patients.searchPatients, { query: '0750 999' });
    expect(byName.ok && byName.data.map((p) => p.name)).toEqual(['Sara Ali']);
    expect(byPhone.ok && byPhone.data.map((p) => p.name)).toEqual(['Omar Hassan']);
  });

  it('shows a patient with the rest of the household, and never a patient of another clinic', async () => {
    const a = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    const b = await person('rec@b.test', 'clinic-b', 'RECEPTION');
    await runClAction(prisma(), a, patients.createPatient, { name: 'Sara Ali', phone: '07701234567' });
    await runClAction(prisma(), a, patients.createPatient, { name: 'Omar Ali', phone: '07701234567' });
    await runClAction(prisma(), b, patients.createPatient, { name: 'Zed', phone: '07701234567' });
    const sara = await prisma().clPatient.findFirstOrThrow({ where: { name: 'Sara Ali' } });
    const zed = await prisma().clPatient.findFirstOrThrow({ where: { name: 'Zed' } });
    const shown = await runClAction(prisma(), a, patients.getPatient, { patientId: sara.id });
    expect(shown.ok && shown.data.household.map((p) => p.name).sort()).toEqual(['Omar Ali', 'Sara Ali']);
    expect(code(await runClAction(prisma(), a, patients.getPatient, { patientId: zed.id }))).toBe('NOT_FOUND');
    expect(code(await runClAction(prisma(), a, patients.updatePatient, { patientId: zed.id, name: 'X', phone: '07701234567' }))).toBe('NOT_FOUND');
  });

  it('moves a patient to another household when the phone changes, with no audit of the new value', async () => {
    const a = await person('rec@a.test', 'clinic-a', 'RECEPTION');
    await runClAction(prisma(), a, patients.createPatient, { name: 'Sara Ali', phone: '07701234567' });
    const sara = await prisma().clPatient.findFirstOrThrow({});
    const result = await runClAction(prisma(), a, patients.updatePatient, { patientId: sara.id, name: 'Sara A. Ali', phone: '07509998888' });
    expect(result.ok).toBe(true);
    const after = await prisma().clPatient.findUniqueOrThrow({ where: { id: sara.id }, include: { household: true } });
    expect(after.household.phone).toBe('07509998888');
    const audit = await prisma().auditLog.findMany({ where: { action: 'clinic.patient_updated' } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/Sara|0750|9998888/);
  });
});

describe('who may open the patient file', () => {
  it('lets the owner and the receptionist, and refuses a doctor and the one who takes payments', async () => {
    const owner = await person('owner@a.test', 'clinic-a', 'OWNER');
    const doctor = await person('doc@a.test', 'clinic-a', 'DOCTOR');
    const cashier = await person('cash@a.test', 'clinic-a', 'CASHIER');
    expect(code(await runClAction(prisma(), owner, patients.searchPatients, { query: '' }))).toBe('OK');
    expect(code(await runClAction(prisma(), doctor, patients.searchPatients, { query: '' }))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), cashier, patients.createPatient, { name: 'A', phone: '07701234567' }))).toBe('FORBIDDEN');
  });
});
