import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { assertFree, createBookingCore, freeSlots, serviceTerms } from '../booking/core';
import { defineClAction } from '../framework';
import { dayRange, isDay, localDay } from '../time';

/**
 * Booking for the owner and the receptionist. Every time comes from the booking engine's free list, so no screen can
 * book outside a doctor's week or on top of another booking. Audit rows name the booking by its id only: the patient's
 * name and phone never enter the log.
 */

const ROLES = ['OWNER', 'RECEPTION'] as const;
const MINUTE = 60_000;

const idField = z.string().min(1).max(64);
const dayField = z.string().refine(isDay, 'Choose a date');
const instant = z.string().datetime().transform((text) => new Date(text));

export const listSlots = defineClAction({
  name: 'clinic.bookings.slots',
  roles: [...ROLES],
  input: z.object({ doctorId: idField, day: dayField, serviceId: idField.optional() }),
  run: async (ctx, { doctorId, day, serviceId }) => {
    const { durationMin } = await serviceTerms(ctx.db, serviceId);
    const slots = await freeSlots(ctx.db, { doctorId, day, durationMin, now: new Date() });
    return slots.map((slot) => slot.toISOString());
  },
});

export const createBooking = defineClAction({
  name: 'clinic.bookings.create',
  roles: [...ROLES],
  input: z.object({ doctorId: idField, patientId: idField, serviceId: idField.optional(), startsAt: instant, waitlistEntryId: idField.optional() }),
  run: async (ctx, { doctorId, patientId, serviceId, startsAt, waitlistEntryId }) => {
    const row = await createBookingCore(ctx.db, { doctorId, patientId, serviceId, startsAt, source: 'STAFF', restaurantId: ctx.restaurantId, now: new Date() });
    if (waitlistEntryId) await ctx.db.clWaitlistEntry.updateMany({ where: { id: waitlistEntryId, patientId, status: 'WAITING' }, data: { status: 'BOOKED' } });
    ctx.audit({ action: 'clinic.booking_created', entityType: 'ClBooking', entityId: row.id, changes: {} });
    return { bookingId: row.id };
  },
});

/** A booking of this clinic that has not been seen yet; anything else is refused. */
async function openBooking(ctx: Parameters<Parameters<typeof defineClAction>[0]['run']>[0], bookingId: string) {
  const row = await ctx.db.clBooking.findFirst({ where: { id: bookingId } });
  if (!row) throw new StudioError('NOT_FOUND');
  if (row.status !== 'BOOKED') throw new StudioError('INVALID', 'This booking can no longer be changed');
  return row;
}

export const cancelBooking = defineClAction({
  name: 'clinic.bookings.cancel',
  roles: [...ROLES],
  input: z.object({ bookingId: idField }),
  run: async (ctx, { bookingId }) => {
    const row = await openBooking(ctx, bookingId);
    await ctx.db.clBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
    ctx.audit({ action: 'clinic.booking_cancelled', entityType: 'ClBooking', entityId: bookingId, changes: {} });
    // Who could take the freed time: those waiting that day for this doctor or for any.
    const waiting = await ctx.db.clWaitlistEntry.findMany({
      where: { day: localDay(row.startsAt), status: 'WAITING', OR: [{ doctorId: row.doctorId }, { doctorId: null }] },
      include: { patient: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { waiting: waiting.map((w) => ({ entryId: w.id, patientName: w.patient.name, patientPhone: w.patient.phone })) };
  },
});

export const rescheduleBooking = defineClAction({
  name: 'clinic.bookings.reschedule',
  roles: [...ROLES],
  input: z.object({ bookingId: idField, startsAt: instant }),
  run: async (ctx, { bookingId, startsAt }) => {
    const row = await openBooking(ctx, bookingId);
    const durationMin = Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / MINUTE);
    await assertFree(ctx.db, { doctorId: row.doctorId, durationMin, now: new Date(), startsAt, ignoreBookingId: bookingId });
    await ctx.db.clBooking.update({ where: { id: bookingId }, data: { startsAt, endsAt: new Date(startsAt.getTime() + durationMin * MINUTE) } });
    ctx.audit({ action: 'clinic.booking_rescheduled', entityType: 'ClBooking', entityId: bookingId, changes: {} });
    return null;
  },
});

export const markNoShow = defineClAction({
  name: 'clinic.bookings.noShow',
  roles: [...ROLES],
  input: z.object({ bookingId: idField }),
  run: async (ctx, { bookingId }) => {
    await openBooking(ctx, bookingId);
    await ctx.db.clBooking.update({ where: { id: bookingId }, data: { status: 'NO_SHOW' } });
    ctx.audit({ action: 'clinic.booking_no_show', entityType: 'ClBooking', entityId: bookingId, changes: {} });
    return null;
  },
});

export const listDay = defineClAction({
  name: 'clinic.bookings.listDay',
  roles: [...ROLES],
  input: z.object({ day: dayField, doctorId: idField.optional() }),
  run: async (ctx, { day, doctorId }) => {
    const { start, end } = dayRange(day);
    const rows = await ctx.db.clBooking.findMany({
      where: { startsAt: { gte: start, lt: end }, status: { not: 'CANCELLED' }, ...(doctorId ? { doctorId } : {}) },
      include: {
        patient: { select: { name: true, phone: true } },
        service: { select: { name: true } },
        doctor: { select: { member: { select: { account: { select: { name: true } } } } } },
      },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((b) => ({
      bookingId: b.id,
      doctorId: b.doctorId,
      doctorName: b.doctor.member.account.name,
      patientId: b.patientId,
      patientName: b.patient.name,
      patientPhone: b.patient.phone,
      serviceName: b.service?.name ?? null,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      status: b.status,
      source: b.source,
      depositAmount: b.depositAmount,
    }));
  },
});

export const addToWaitlist = defineClAction({
  name: 'clinic.waitlist.add',
  roles: [...ROLES],
  input: z.object({ patientId: idField, doctorId: idField.optional(), day: dayField }),
  run: async (ctx, { patientId, doctorId, day }) => {
    const patient = await ctx.db.clPatient.findFirst({ where: { id: patientId } });
    if (!patient) throw new StudioError('NOT_FOUND');
    if (doctorId && !(await ctx.db.clDoctor.findFirst({ where: { id: doctorId } }))) throw new StudioError('NOT_FOUND');
    const row = await ctx.db.clWaitlistEntry.create({ data: { restaurantId: ctx.restaurantId, patientId, doctorId: doctorId ?? null, day } });
    ctx.audit({ action: 'clinic.waitlist_added', entityType: 'ClWaitlistEntry', entityId: row.id, changes: {} });
    return { entryId: row.id };
  },
});

export const listWaitlist = defineClAction({
  name: 'clinic.waitlist.list',
  roles: [...ROLES],
  input: z.object({ day: dayField }),
  run: async (ctx, { day }) => {
    const rows = await ctx.db.clWaitlistEntry.findMany({ where: { day, status: 'WAITING' }, include: { patient: { select: { name: true, phone: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((w) => ({ entryId: w.id, patientId: w.patientId, patientName: w.patient.name, patientPhone: w.patient.phone, doctorId: w.doctorId }));
  },
});

export const removeFromWaitlist = defineClAction({
  name: 'clinic.waitlist.remove',
  roles: [...ROLES],
  input: z.object({ entryId: idField }),
  run: async (ctx, { entryId }) => {
    const { count } = await ctx.db.clWaitlistEntry.updateMany({ where: { id: entryId, status: 'WAITING' }, data: { status: 'REMOVED' } });
    if (count === 0) throw new StudioError('NOT_FOUND');
    return null;
  },
});
