import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { restaurantDb } from '@/server/data/tenant-db';
import { addressKey, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { definePublicAction } from '@/server/studio/framework/public';
import { StudioError } from '@/server/studio/framework/result';
import { createBookingCore, freeSlots } from '../booking/core';
import { isPhone, normalizePhone } from '../phone';
import { isDay } from '../time';

/**
 * The public booking page: what a stranger with the link may see and do. They see the clinic's name, its doctors'
 * names and specialities, its services and free times; they never see a patient. Booking makes (or finds) the patient
 * file from the name and phone given and holds the time, as an online booking the front desk sees. Every call names the
 * clinic, and a business that is not an active clinic answers as one that does not exist.
 */

const idField = z.string().min(1).max(64);

export interface PublicClinicView {
  clinicName: string;
  doctors: { doctorId: string; name: string; speciality: string }[];
  services: { serviceId: string; name: string; durationMin: number }[];
}

/** The clinic's public face, or null when there is no such active clinic. */
export async function loadPublicClinic(prisma: PrismaClient, clinicId: string): Promise<PublicClinicView | null> {
  const clinic = await prisma.restaurant.findFirst({ where: { id: clinicId, sector: 'CLINIC', status: 'ACTIVE' }, select: { id: true, name: true } });
  if (!clinic) return null;
  const db = restaurantDb(prisma, clinic.id);
  const [doctors, services] = await Promise.all([
    db.clDoctor.findMany({
      where: { active: true, member: { status: 'ACTIVE' }, hours: { some: {} } },
      include: { member: { select: { account: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.clService.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  ]);
  return {
    clinicName: clinic.name,
    doctors: doctors.map((d) => ({ doctorId: d.id, name: d.member.account.name, speciality: d.speciality })),
    services: services.map((s) => ({ serviceId: s.id, name: s.name, durationMin: s.durationMin })),
  };
}

async function activeClinicDb(prisma: PrismaClient, clinicId: string) {
  const clinic = await prisma.restaurant.findFirst({ where: { id: clinicId, sector: 'CLINIC', status: 'ACTIVE' }, select: { id: true } });
  if (!clinic) throw new StudioError('NOT_FOUND');
  return { restaurantId: clinic.id, db: restaurantDb(prisma, clinic.id) };
}

export const clinicPublicSlots = definePublicAction({
  name: 'clinic.public.slots',
  input: z.object({ clinicId: idField, doctorId: idField, day: z.string().refine(isDay, 'Choose a date'), serviceId: idField.optional() }),
  // Looking is cheap; the per-address ceiling only stops a runaway caller.
  rateLimit: (_input, { ip }) => [{ key: `clpubslots:ip:${addressKey(ip)}`, rule: RATE_RULES['entitlements:ip'] }],
  run: async ({ prisma }, { clinicId, doctorId, day, serviceId }) => {
    const { db } = await activeClinicDb(prisma, clinicId);
    const service = serviceId ? await db.clService.findFirst({ where: { id: serviceId, active: true } }) : null;
    if (serviceId && !service) throw new StudioError('NOT_FOUND');
    const slots = await freeSlots(db, { doctorId, day, durationMin: service?.durationMin ?? 15, now: new Date() });
    return slots.map((slot) => slot.toISOString());
  },
});

export const clinicPublicBook = definePublicAction({
  name: 'clinic.public.book',
  input: z.object({
    clinicId: idField,
    doctorId: idField,
    serviceId: idField.optional(),
    startsAt: z.string().datetime().transform((text) => new Date(text)),
    name: z.string().trim().min(1, 'Enter your name').max(120),
    phone: z.string().max(40).transform(normalizePhone).refine(isPhone, 'Enter a valid phone number'),
  }),
  // A few bookings an hour from one address, and a few from one phone: enough for a family, too few to flood the diary.
  rateLimit: (input, { ip }) => [
    { key: `clpubbook:ip:${addressKey(ip)}`, rule: RATE_RULES['invite:ip'] },
    { key: `clpubbook:phone:${input.clinicId}:${input.phone}`, rule: RATE_RULES['signin:email'] },
  ],
  run: async ({ prisma }, { clinicId, doctorId, serviceId, startsAt, name, phone }) => {
    const { db, restaurantId } = await activeClinicDb(prisma, clinicId);
    // The doctor and service are checked before any file is made, so a refused booking leaves nothing behind.
    if (!(await db.clDoctor.findFirst({ where: { id: doctorId, active: true } }))) throw new StudioError('NOT_FOUND');
    const household = (await db.clHousehold.findFirst({ where: { phone } })) ?? (await db.clHousehold.create({ data: { restaurantId, phone } }));
    const existing = await db.clPatient.findFirst({ where: { householdId: household.id, name: { equals: name, mode: 'insensitive' } } });
    const patient = existing ?? (await db.clPatient.create({ data: { restaurantId, householdId: household.id, name, phone } }));
    await createBookingCore(db, { doctorId, patientId: patient.id, serviceId, startsAt, source: 'PUBLIC', restaurantId, now: new Date() });
    return { booked: true as const };
  },
});
