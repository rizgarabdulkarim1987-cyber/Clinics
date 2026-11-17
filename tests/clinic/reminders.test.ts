import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as reminders from '@/server/clinic/actions/reminders';
import { runClAction } from '@/server/clinic/framework';
import { createClAccount, type ClSessionView } from '@/server/clinic/auth/sign-in';
import { fromLocal, localDay } from '@/server/clinic/time';
import { getPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The desk's reminder list: tomorrow's booked patients, each with a WhatsApp link already typed, marked once sent. */

const prisma = () => getPrisma();
const PASSWORD = 'correct horse battery staple';
type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';
const tomorrow = localDay(new Date(Date.now() + 86_400_000));

async function person(email: string, role: Role): Promise<ClSessionView & { memberId: string }> {
  const { id } = await createClAccount(prisma(), { name: email.split('@')[0]!, email, password: PASSWORD });
  const member = await prisma().clMember.create({ data: { accountId: id, restaurantId: 'clinic-a', role } });
  return { sessionId: 's', accountId: id, name: email.split('@')[0]!, email, space: 'CLINIC' as const, memberId: member.id };
}

let owner: ClSessionView;
let reception: ClSessionView;
let doctor: ClSessionView;
let doctorId: string;

async function booking(name: string, phone: string, minutes: number, status: 'BOOKED' | 'CANCELLED' = 'BOOKED', day = tomorrow) {
  const household = await prisma().clHousehold.create({ data: { restaurantId: 'clinic-a', phone: `${phone}-${name}` } });
  const patient = await prisma().clPatient.create({ data: { restaurantId: 'clinic-a', householdId: household.id, name, phone } });
  return prisma().clBooking.create({ data: { restaurantId: 'clinic-a', doctorId, patientId: patient.id, startsAt: fromLocal(day, minutes), endsAt: fromLocal(day, minutes + 15), status } });
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'OK' : result.error!.code);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  await prisma().restaurant.create({ data: { id: 'clinic-a', name: 'Smile Clinic', type: 'CAFE', sector: 'CLINIC', status: 'ACTIVE' } });
  await prisma().clSettings.create({ data: { restaurantId: 'clinic-a' } });
  owner = await person('owner@a.test', 'OWNER');
  reception = await person('desk@a.test', 'RECEPTION');
  const who = await person('dr@a.test', 'DOCTOR');
  doctor = who;
  doctorId = (await prisma().clDoctor.create({ data: { restaurantId: 'clinic-a', memberId: who.memberId } })).id;
});

describe('the reminder list', () => {
  it('lists tomorrow’s booked patients in time order with a typed WhatsApp link', async () => {
    await booking('Zainab', '0770 123 4567', 11 * 60);
    await booking('Ali', '07701234568', 9 * 60 + 30);
    await booking('Cancelled One', '07701234569', 10 * 60, 'CANCELLED');
    await booking('Later Day', '07701234560', 10 * 60, 'BOOKED', localDay(new Date(Date.now() + 3 * 86_400_000)));
    const result = await runClAction(prisma(), reception, reminders.listReminders, {});
    if (!result.ok) throw new Error('expected a list');
    expect(result.data.day).toBe(tomorrow);
    expect(result.data.rows.map((r) => [r.patientName, r.time])).toEqual([['Ali', '09:30'], ['Zainab', '11:00']]);
    const link = result.data.rows[0]!.link!;
    expect(link.startsWith('https://wa.me/9647701234568?text=')).toBe(true);
    const text = decodeURIComponent(link.split('text=')[1]!);
    expect(text).toContain('Ali');
    expect(text).toContain('Smile Clinic');
    expect(text).toContain('09:30');
  });

  it('gives no link for a phone that cannot be used', async () => {
    await booking('NoPhone', '12', 600);
    const result = await runClAction(prisma(), reception, reminders.listReminders, {});
    if (!result.ok) throw new Error('expected a list');
    expect(result.data.rows[0]?.link).toBeNull();
  });

  it('marks a reminder as sent once, and only for a booking that is still booked', async () => {
    const b = await booking('Ali', '07701234568', 600);
    expect(code(await runClAction(prisma(), reception, reminders.markReminded, { bookingId: b.id }))).toBe('OK');
    const listed = await runClAction(prisma(), reception, reminders.listReminders, {});
    if (!listed.ok) throw new Error('expected a list');
    expect(listed.data.rows[0]?.remindedAt).not.toBeNull();
    const cancelled = await booking('Gone', '07701234500', 700, 'CANCELLED');
    expect(code(await runClAction(prisma(), reception, reminders.markReminded, { bookingId: cancelled.id }))).toBe('INVALID');
  });

  it('lets the owner set the wording, and falls back to the built-in text when it is emptied', async () => {
    await booking('Ali', '07701234568', 600);
    expect(code(await runClAction(prisma(), owner, reminders.saveReminderText, { text: 'Hi {name}, see you at {time}' }))).toBe('OK');
    const custom = await runClAction(prisma(), reception, reminders.listReminders, {});
    if (!custom.ok) throw new Error('expected a list');
    expect(decodeURIComponent(custom.data.rows[0]!.link!.split('text=')[1]!)).toBe('Hi Ali, see you at 10:00');
    await runClAction(prisma(), owner, reminders.saveReminderText, { text: '   ' });
    const back = await runClAction(prisma(), reception, reminders.listReminders, {});
    if (!back.ok) throw new Error('expected a list');
    expect(back.data.template).toBeNull();
    expect(decodeURIComponent(back.data.rows[0]!.link!.split('text=')[1]!)).toContain('Smile Clinic');
  });

  it('keeps the list to the desk and the wording to the owner', async () => {
    expect(code(await runClAction(prisma(), doctor, reminders.listReminders, {}))).toBe('FORBIDDEN');
    expect(code(await runClAction(prisma(), reception, reminders.saveReminderText, { text: 'x' }))).toBe('FORBIDDEN');
  });
});
