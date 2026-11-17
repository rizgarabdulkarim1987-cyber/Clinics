import type { RestaurantDb } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import { dayRange, fromLocal, isDay, localDay, SLOT_STEP_MIN, weekdayOf } from '../time';

/**
 * The booking engine, used by the staff actions and the public page alike. A doctor's free times are their working
 * hours for that weekday, on a 15 minute grid, less every live booking, and never in the past. Booking takes a time from
 * that list and nothing else, so no screen can book outside the week or on top of another booking; the partial unique
 * index on (doctor, start) closes the race the check alone leaves between two desks.
 */

export const LIVE_STATUSES = ['BOOKED', 'CHECKED_IN'] as const;
const MINUTE = 60_000;
const TAKEN = 'This time was just taken. Choose another';

/** What a booking takes, from its service (a plain 15 minute visit when there is none). */
export async function serviceTerms(db: RestaurantDb, serviceId: string | undefined): Promise<{ serviceId: string | null; durationMin: number; depositAmount: number }> {
  if (!serviceId) return { serviceId: null, durationMin: SLOT_STEP_MIN, depositAmount: 0 };
  const service = await db.clService.findFirst({ where: { id: serviceId, active: true } });
  if (!service) throw new StudioError('NOT_FOUND');
  return { serviceId: service.id, durationMin: service.durationMin, depositAmount: service.depositAmount };
}

export interface SlotQuery {
  doctorId: string;
  day: string;
  durationMin: number;
  now: Date;
  /** A booking being moved: its own time does not block it. */
  ignoreBookingId?: string;
}

/** The start times a doctor can still be booked at on a clinic day, earliest first. */
export async function freeSlots(db: RestaurantDb, { doctorId, day, durationMin, now, ignoreBookingId }: SlotQuery): Promise<Date[]> {
  if (!isDay(day)) return [];
  const doctor = await db.clDoctor.findFirst({ where: { id: doctorId, active: true, member: { status: 'ACTIVE' } } });
  if (!doctor) return [];
  const hours = await db.clDoctorHours.findMany({ where: { doctorId, weekday: weekdayOf(day) } });
  if (hours.length === 0) return [];
  // A day of leave has no free times, whatever the week says.
  const away = await db.clDoctorLeave.findFirst({ where: { doctorId, fromDay: { lte: day }, toDay: { gte: day } }, select: { id: true } });
  if (away) return [];
  const { start, end } = dayRange(day);
  const booked = await db.clBooking.findMany({
    where: { doctorId, status: { in: [...LIVE_STATUSES] }, startsAt: { lt: end }, endsAt: { gt: start }, ...(ignoreBookingId ? { id: { not: ignoreBookingId } } : {}) },
  });
  const slots = new Map<number, Date>();
  for (const block of hours) {
    for (let minute = Math.ceil(block.startMin / SLOT_STEP_MIN) * SLOT_STEP_MIN; minute + durationMin <= block.endMin; minute += SLOT_STEP_MIN) {
      const from = fromLocal(day, minute);
      const to = new Date(from.getTime() + durationMin * MINUTE);
      if (from <= now) continue;
      if (booked.some((b) => b.startsAt < to && b.endsAt > from)) continue;
      slots.set(from.getTime(), from);
    }
  }
  return [...slots.values()].sort((a, b) => a.getTime() - b.getTime());
}

const isUniqueViolation = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';

/** Whether `startsAt` is one of the doctor's free times for that duration. */
export async function assertFree(db: RestaurantDb, query: Omit<SlotQuery, 'day'> & { startsAt: Date }): Promise<void> {
  const free = await freeSlots(db, { ...query, day: localDay(query.startsAt) });
  if (!free.some((slot) => slot.getTime() === query.startsAt.getTime())) throw new StudioError('INVALID', TAKEN, { startsAt: TAKEN });
}

export interface NewBooking {
  doctorId: string;
  patientId: string;
  serviceId?: string;
  startsAt: Date;
  source: 'STAFF' | 'PUBLIC';
  restaurantId: string;
  now: Date;
}

/** Books a free time. Another clinic's doctor, patient or service answers as one that does not exist. */
export async function createBookingCore(db: RestaurantDb, input: NewBooking) {
  const doctor = await db.clDoctor.findFirst({ where: { id: input.doctorId } });
  const patient = await db.clPatient.findFirst({ where: { id: input.patientId } });
  if (!doctor || !patient) throw new StudioError('NOT_FOUND');
  const terms = await serviceTerms(db, input.serviceId);
  await assertFree(db, { doctorId: doctor.id, durationMin: terms.durationMin, now: input.now, startsAt: input.startsAt });
  try {
    return await db.clBooking.create({
      data: {
        restaurantId: input.restaurantId,
        doctorId: doctor.id,
        patientId: patient.id,
        serviceId: terms.serviceId,
        startsAt: input.startsAt,
        endsAt: new Date(input.startsAt.getTime() + terms.durationMin * MINUTE),
        source: input.source,
        depositAmount: terms.depositAmount,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new StudioError('INVALID', TAKEN, { startsAt: TAKEN });
    throw error;
  }
}
