import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { routeDoctor, type ClRule } from '../booking/routing';
import { createTicket } from '../booking/tickets';
import { defineClAction, type ClContext } from '../framework';
import { dayRange, localDay } from '../time';

/**
 * The clinic's day board. A token moves Waiting, With the doctor, To pay, Done. The owner and receptionist see and
 * move every token; a doctor sees and changes only their own; the one who takes payments sees only To pay and Done.
 * Each step is a guarded update ("only if it is still in the state this click saw"), so a stale click is refused
 * instead of undoing someone else's step. No clinical text is on the board, and audit rows name a token by its id.
 */

const RULES = ['SHORTEST_WAIT', 'OWN_DOCTOR', 'SPECIALITY', 'TURN'] as const;
const idField = z.string().min(1).max(64);
const DESK = ['OWNER', 'RECEPTION'] as const;

/** The doctor profile of the signed-in doctor, or null for any other role or a doctor without a profile. */
async function ownDoctorId(ctx: ClContext): Promise<string | null> {
  if (ctx.member.role !== 'DOCTOR') return null;
  return (await ctx.db.clDoctor.findFirst({ where: { memberId: ctx.member.memberId }, select: { id: true } }))?.id ?? null;
}

/** A ticket of this clinic; a doctor only gets their own, and anything else answers as one that does not exist. */
async function ticketFor(ctx: ClContext, ticketId: string) {
  const ticket = await ctx.db.clTicket.findFirst({ where: { id: ticketId } });
  if (!ticket) throw new StudioError('NOT_FOUND');
  if (ctx.member.role === 'DOCTOR' && ticket.doctorId !== (await ownDoctorId(ctx))) throw new StudioError('NOT_FOUND');
  return ticket;
}

const STALE = 'This token has already moved on';

/** Moves a ticket from one of `from` to `to` only if it is still in that state and still with the doctor the caller was checked against (a hand-over in between refuses the step). */
async function step(ctx: ClContext, ticket: { id: string; doctorId: string }, from: readonly ('WAITING' | 'WITH_DOCTOR' | 'TO_PAY')[], to: 'WITH_DOCTOR' | 'TO_PAY' | 'DONE' | 'LEFT', extra: Record<string, unknown> = {}) {
  const { count } = await ctx.db.clTicket.updateMany({ where: { id: ticket.id, doctorId: ticket.doctorId, status: { in: [...from] } }, data: { status: to, ...extra } });
  if (count === 0) throw new StudioError('INVALID', STALE);
}

async function activeDoctor(ctx: ClContext, doctorId: string) {
  const doctor = await ctx.db.clDoctor.findFirst({ where: { id: doctorId, active: true, member: { status: 'ACTIVE' } } });
  if (!doctor) throw new StudioError('NOT_FOUND');
  return doctor;
}

async function settingsRow(ctx: ClContext) {
  return ctx.db.clSettings.findFirst({});
}

export const getDistribution = defineClAction({
  name: 'clinic.board.getDistribution',
  roles: [...DESK],
  input: z.object({}),
  run: async (ctx) => ({ rule: ((await settingsRow(ctx))?.distribution ?? 'SHORTEST_WAIT') as ClRule }),
});

export const saveDistribution = defineClAction({
  name: 'clinic.board.saveDistribution',
  roles: ['OWNER'],
  input: z.object({ rule: z.enum(RULES) }),
  run: async (ctx, { rule }) => {
    const row = await settingsRow(ctx);
    if (row) await ctx.db.clSettings.updateMany({ where: { id: row.id }, data: { distribution: rule } });
    else await ctx.db.clSettings.create({ data: { restaurantId: ctx.restaurantId, distribution: rule } });
    ctx.audit({ action: 'clinic.distribution_saved', entityType: 'ClSettings', entityId: row?.id ?? ctx.restaurantId, changes: { rule: { before: row?.distribution ?? null, after: rule } } });
    return null;
  },
});

export const addWalkIn = defineClAction({
  name: 'clinic.board.addWalkIn',
  roles: [...DESK],
  input: z.object({ patientId: idField, doctorId: idField.optional(), speciality: z.string().trim().max(80).optional() }),
  run: async (ctx, { patientId, doctorId, speciality }) => {
    const patient = await ctx.db.clPatient.findFirst({ where: { id: patientId } });
    if (!patient) throw new StudioError('NOT_FOUND');
    const now = new Date();
    const settings = await settingsRow(ctx);
    let chosen: string;
    if (doctorId) chosen = (await activeDoctor(ctx, doctorId)).id;
    else {
      const rule = (settings?.distribution ?? 'SHORTEST_WAIT') as ClRule;
      const routed = await routeDoctor(ctx.db, { rule, now, patientId, speciality, lastTurnDoctorId: settings?.lastTurnDoctorId ?? null });
      if (!routed) throw new StudioError('INVALID', 'No doctor is available');
      chosen = routed.doctorId;
      if (rule === 'TURN') {
        if (settings) await ctx.db.clSettings.updateMany({ where: { id: settings.id }, data: { lastTurnDoctorId: chosen } });
        else await ctx.db.clSettings.create({ data: { restaurantId: ctx.restaurantId, lastTurnDoctorId: chosen } });
      }
    }
    const ticket = await createTicket(ctx.db, { restaurantId: ctx.restaurantId, day: localDay(now), patientId, doctorId: chosen });
    ctx.audit({ action: 'clinic.ticket_created', entityType: 'ClTicket', entityId: ticket.id, changes: {} });
    return { ticketId: ticket.id, number: ticket.number };
  },
});

export const checkIn = defineClAction({
  name: 'clinic.board.checkIn',
  roles: [...DESK],
  input: z.object({ bookingId: idField }),
  run: async (ctx, { bookingId }) => {
    const booking = await ctx.db.clBooking.findFirst({ where: { id: bookingId } });
    if (!booking) throw new StudioError('NOT_FOUND');
    const today = localDay(new Date());
    if (booking.status !== 'BOOKED' || localDay(booking.startsAt) !== today) throw new StudioError('INVALID', 'This booking cannot be checked in');
    const { count } = await ctx.db.clBooking.updateMany({ where: { id: bookingId, status: 'BOOKED' }, data: { status: 'CHECKED_IN' } });
    if (count === 0) throw new StudioError('INVALID', 'This booking cannot be checked in');
    const ticket = await createTicket(ctx.db, { restaurantId: ctx.restaurantId, day: today, patientId: booking.patientId, doctorId: booking.doctorId, bookingId });
    ctx.audit({ action: 'clinic.ticket_created', entityType: 'ClTicket', entityId: ticket.id, changes: {} });
    return { ticketId: ticket.id, number: ticket.number };
  },
});

export const moveTicket = defineClAction({
  name: 'clinic.board.move',
  roles: [...DESK],
  input: z.object({ ticketId: idField, doctorId: idField }),
  run: async (ctx, { ticketId, doctorId }) => {
    await ticketFor(ctx, ticketId);
    const doctor = await activeDoctor(ctx, doctorId);
    const { count } = await ctx.db.clTicket.updateMany({ where: { id: ticketId, status: 'WAITING' }, data: { doctorId: doctor.id } });
    if (count === 0) throw new StudioError('INVALID', STALE);
    ctx.audit({ action: 'clinic.ticket_moved', entityType: 'ClTicket', entityId: ticketId, changes: {} });
    return null;
  },
});

export const callTicket = defineClAction({
  name: 'clinic.board.call',
  roles: [...DESK, 'DOCTOR'],
  input: z.object({ ticketId: idField }),
  run: async (ctx, { ticketId }) => {
    const ticket = await ticketFor(ctx, ticketId);
    await step(ctx, ticket, ['WAITING'], 'WITH_DOCTOR', { calledAt: new Date() });
    return null;
  },
});

export const endVisit = defineClAction({
  name: 'clinic.board.endVisit',
  roles: [...DESK, 'DOCTOR'],
  input: z.object({ ticketId: idField }),
  run: async (ctx, { ticketId }) => {
    const ticket = await ticketFor(ctx, ticketId);
    await step(ctx, ticket, ['WITH_DOCTOR'], 'TO_PAY', { endedAt: new Date() });
    if (ticket.bookingId) await ctx.db.clBooking.updateMany({ where: { id: ticket.bookingId }, data: { status: 'DONE' } });
    return null;
  },
});

export const handOver = defineClAction({
  name: 'clinic.board.handOver',
  roles: [...DESK, 'DOCTOR'],
  input: z.object({ ticketId: idField, doctorId: idField }),
  run: async (ctx, { ticketId, doctorId }) => {
    const ticket = await ticketFor(ctx, ticketId);
    const doctor = await activeDoctor(ctx, doctorId);
    if (doctor.id === ticket.doctorId) throw new StudioError('INVALID', 'Choose another doctor');
    const { count } = await ctx.db.clTicket.updateMany({
      where: { id: ticketId, doctorId: ticket.doctorId, status: { in: ['WAITING', 'WITH_DOCTOR'] } },
      data: { doctorId: doctor.id, status: 'WAITING', handedFromDoctorId: ticket.doctorId, calledAt: null },
    });
    if (count === 0) throw new StudioError('INVALID', STALE);
    ctx.audit({ action: 'clinic.ticket_handed_over', entityType: 'ClTicket', entityId: ticketId, changes: {} });
    return null;
  },
});

export const markLeft = defineClAction({
  name: 'clinic.board.markLeft',
  roles: [...DESK],
  input: z.object({ ticketId: idField }),
  run: async (ctx, { ticketId }) => {
    const ticket = await ticketFor(ctx, ticketId);
    await step(ctx, ticket, ['WAITING'], 'LEFT');
    ctx.audit({ action: 'clinic.ticket_left', entityType: 'ClTicket', entityId: ticketId, changes: {} });
    return null;
  },
});

/** To pay to Done. The bill and the payment arrive with the visit plan; until then the desk or the till closes the token. */
export const finishTicket = defineClAction({
  name: 'clinic.board.finish',
  roles: [...DESK, 'CASHIER'],
  input: z.object({ ticketId: idField }),
  run: async (ctx, { ticketId }) => {
    const ticket = await ticketFor(ctx, ticketId);
    await step(ctx, ticket, ['TO_PAY'], 'DONE');
    return null;
  },
});

export const loadBoard = defineClAction({
  name: 'clinic.board.load',
  roles: [...DESK, 'DOCTOR', 'CASHIER'],
  input: z.object({}),
  run: async (ctx) => {
    const day = localDay(new Date());
    const own = await ownDoctorId(ctx);
    const role = ctx.member.role;
    const where =
      role === 'CASHIER' ? { day, status: { in: ['TO_PAY', 'DONE'] as ('TO_PAY' | 'DONE')[] } } : role === 'DOCTOR' ? { day, status: { not: 'LEFT' as const }, doctorId: own ?? '-' } : { day, status: { not: 'LEFT' as const } };
    const [tickets, doctors] = await Promise.all([
      ctx.db.clTicket.findMany({ where, include: { patient: { select: { name: true } } }, orderBy: { number: 'asc' } }),
      ctx.db.clDoctor.findMany({ include: { member: { select: { account: { select: { name: true } } } } } }),
    ]);
    const names = new Map(doctors.map((d) => [d.id, d.member.account.name]));
    return {
      day,
      doctorId: own,
      tickets: tickets.map((t) => ({
        ticketId: t.id,
        number: t.number,
        status: t.status,
        patientName: t.patient.name,
        doctorId: t.doctorId,
        doctorName: names.get(t.doctorId) ?? '',
        handedFromName: t.handedFromDoctorId ? (names.get(t.handedFromDoctorId) ?? null) : null,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  },
});

/** Today's bookings whose patient has not arrived yet, for the one-tap check-in. */
export const listArrivals = defineClAction({
  name: 'clinic.board.arrivals',
  roles: [...DESK],
  input: z.object({}),
  run: async (ctx) => {
    const { start, end } = dayRange(localDay(new Date()));
    const rows = await ctx.db.clBooking.findMany({
      where: { status: 'BOOKED', startsAt: { gte: start, lt: end } },
      include: { patient: { select: { name: true } }, doctor: { select: { member: { select: { account: { select: { name: true } } } } } } },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((b) => ({ bookingId: b.id, patientName: b.patient.name, doctorName: b.doctor.member.account.name, startsAt: b.startsAt.toISOString() }));
  },
});
