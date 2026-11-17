import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as files from '@/server/clinic/actions/patient-files';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Patient photos and documents: private, checked by content, limited in size and number, readable only by who may. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';

async function person(email: string, role: Role, space: 'CLINIC' | 'BEAUTY' = 'CLINIC', restaurantId = 'clinic-a'): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD, space });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId, role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, space, memberId: member.id };
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]).toString('base64');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(32, 2)]).toString('base64');
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);

let owner: ClSessionView;
let reception: ClSessionView;
let cashier: ClSessionView;
let doctor: ClSessionView;
let patientId: string;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'CAFE', sector: 'CLINIC', status: 'ACTIVE' } });
  await prisma().restaurant.create({ data: { id: 'glow', name: 'Glow', type: 'CAFE', sector: 'CLINIC', status: 'ACTIVE', clSettings: { create: { kind: 'BEAUTY' } } } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a' } });
  owner = await person('owner@a.test', 'OWNER');
  reception = await person('desk@a.test', 'RECEPTION');
  cashier = await person('till@a.test', 'CASHIER');
  doctor = await person('dr@a.test', 'DOCTOR');
  const household = await prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone: '0770' } });
  patientId = (await prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId: household.id, name: 'Zainab', phone: '0770' } })).id;
});

describe('patient files in a clinic', () => {
  it('lets a doctor save, list, read and delete a photo, and nobody else touch it', async () => {
    const saved = await runClAction(prisma(), doctor, files.saveFile, { patientId, name: 'xray.png', mime: 'image/png', data: PNG });
    if (!saved.ok) throw new Error('expected a save');
    const listed = await runClAction(prisma(), doctor, files.listFiles, { patientId });
    expect(listed).toMatchObject({ ok: true, data: [{ fileId: saved.data.fileId, name: 'xray.png', mime: 'image/png' }] });
    expect(JSON.stringify(listed)).not.toContain(PNG);
    const read = await runClAction(prisma(), doctor, files.readFile, { fileId: saved.data.fileId });
    expect(read).toMatchObject({ ok: true, data: { mime: 'image/png', data: PNG } });
    for (const who of [owner, reception, cashier]) {
      expect(code(await runClAction(prisma(), who, files.listFiles, { patientId }))).toBe('FORBIDDEN');
      expect(code(await runClAction(prisma(), who, files.readFile, { fileId: saved.data.fileId }))).toBe('FORBIDDEN');
      expect(code(await runClAction(prisma(), who, files.saveFile, { patientId, name: 'a.png', mime: 'image/png', data: PNG }))).toBe('FORBIDDEN');
    }
    expect(code(await runClAction(prisma(), doctor, files.deleteFile, { fileId: saved.data.fileId }))).toBe('OK');
    expect(await prisma().clPatientFile.count()).toBe(0);
  });

  it('checks the content, not the name: a program called photo.png is refused', async () => {
    const exe = Buffer.from('MZ' + 'x'.repeat(40)).toString('base64');
    expect(code(await runClAction(prisma(), doctor, files.saveFile, { patientId, name: 'photo.png', mime: 'image/png', data: exe }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), doctor, files.saveFile, { patientId, name: 'a.exe', mime: 'application/x-msdownload', data: exe }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), doctor, files.saveFile, { patientId, name: 'a.pdf', mime: 'application/pdf', data: PNG }))).toBe('INVALID');
    expect(code(await runClAction(prisma(), doctor, files.saveFile, { patientId, name: 'a.pdf', mime: 'application/pdf', data: PDF }))).toBe('OK');
  });

  it('refuses a file over 3 MB and a thirty-first file', async () => {
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3 * 1024 * 1024)]).toString('base64');
    expect(code(await runClAction(prisma(), doctor, files.saveFile, { patientId, name: 'big.png', mime: 'image/png', data: big }))).toBe('INVALID');
    for (let i = 0; i < 30; i += 1) await prisma().clPatientFile.create({ data: { restaurantId: 'clinic-a', patientId, name: `f${i}.png`, mime: 'image/png', bytes: 40, data: Buffer.alloc(40), uploadedById: 'x' } });
    expect(code(await runClAction(prisma(), doctor, files.saveFile, { patientId, name: 'one-more.png', mime: 'image/png', data: PNG }))).toBe('INVALID');
  });

  it('does not find a patient or a file of another clinic', async () => {
    expect(code(await runClAction(prisma(), doctor, files.saveFile, { patientId: 'nobody', name: 'a.png', mime: 'image/png', data: PNG }))).toBe('NOT_FOUND');
    expect(code(await runClAction(prisma(), doctor, files.readFile, { fileId: 'nobody' }))).toBe('NOT_FOUND');
  });

  it('keeps the file name plain: no path, no markup', async () => {
    const saved = await runClAction(prisma(), doctor, files.saveFile, { patientId, name: '../../etc/<b>x</b>.png', mime: 'image/png', data: PNG });
    if (!saved.ok) throw new Error('expected a save');
    const row = await prisma().clPatientFile.findUniqueOrThrow({ where: { id: saved.data.fileId } });
    expect(row.name).not.toMatch(/[\\/<>]/);
  });
});

describe('patient files in a beauty centre', () => {
  it('are open to the specialist, the desk and the owner, which keep before and after photos', async () => {
    const stylist = await person('stylist@b.test', 'DOCTOR', 'BEAUTY', 'glow');
    const desk = await person('desk@b.test', 'RECEPTION', 'BEAUTY', 'glow');
    const till = await person('till@b.test', 'CASHIER', 'BEAUTY', 'glow');
    const household = await prisma().clHousehold.create({ data: { restaurantId: 'glow', phone: '0771' } });
    const client = (await prisma().clPatient.create({ data: { restaurantId: 'glow', householdId: household.id, name: 'Lina', phone: '0771' } })).id;
    expect(code(await runClAction(prisma(), stylist, files.saveFile, { patientId: client, name: 'before.png', mime: 'image/png', data: PNG }))).toBe('OK');
    expect(code(await runClAction(prisma(), desk, files.listFiles, { patientId: client }))).toBe('OK');
    expect(code(await runClAction(prisma(), till, files.listFiles, { patientId: client }))).toBe('FORBIDDEN');
  });
});
