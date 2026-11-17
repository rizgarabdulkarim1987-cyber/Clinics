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

/** Courses whose sale bill is still open: neither paid nor left as a debt, so no session of them is spent yet. */
async function unpaidCourseIds(ctx: ClContext, courses: { id: string; billId: string | null }[]): Promise<Set<string>> {
  const billIds = courses.flatMap((c) => (c.billId ? [c.billId] : []));
  if (billIds.length === 0) return new Set();
  const open = await ctx.db.clBill.findMany({ where: { id: { in: billIds }, status: 'OPEN' }, select: { id: true } });
  const openIds = new Set(open.map((b) => b.id));
  return new Set(courses.filter((c) => c.billId && openIds.has(c.billId)).map((c) => c.id));
}

/**
 * Ends a visit: the doctor's short complaint and note, and the fees to charge, picked from that doctor's own fee list (the
 * client sends ids, never amounts). The bill is made here. A visit with nothing to charge closes straight to Done. Only a
 * doctor writes clinical text; the desk may end a visit without any.
 */
export const endVisit = defineClAction({
  name: 'clinic.board.endVisit',
  roles: [...DESK, 'DOCTOR'],
  input: z.object({
    ticketId: idField,
    complaint: z.string().trim().max(300).optional(),
    note: z.string().trim().max(1000).optional(),
    feeIds: z.array(idField).max(20).optional(),
    /** A course of this patient whose session this visit spends. */
    packageId: idField.optional(),
  }),
  run: async (ctx, { ticketId, complaint, note, feeIds, packageId }) => {
    const ticket = await ticketFor(ctx, ticketId);
    if ((complaint || note) && ctx.member.role !== 'DOCTOR') throw new StudioError('FORBIDDEN');
    // A beauty centre keeps no clinical text at all: an appointment ends with its price lines only.
    if ((complaint || note) && ctx.account.space === 'BEAUTY') throw new StudioError('FORBIDDEN');
    const ids = [...new Set(feeIds ?? [])];
    const fees = ids.length > 0 ? await ctx.db.clDoctorFee.findMany({ where: { id: { in: ids }, doctorId: ticket.doctorId }, orderBy: { sortOrder: 'asc' } }) : [];
    if (fees.length !== ids.length) throw new StudioError('NOT_FOUND');
    const total = fees.reduce((sum, fee) => sum + fee.amount, 0);
    // A session is spent first, by a guarded update (only while one is left, only on this patient's course); if the
    // token turns out to have moved on, the session is given back.
    let sessionName: string | null = null;
    if (packageId) {
      const owned = await ctx.db.clPatientPackage.findFirst({ where: { id: packageId, patientId: ticket.patientId } });
      if (!owned) throw new StudioError('NOT_FOUND');
      if ((await unpaidCourseIds(ctx, [owned])).has(owned.id)) throw new StudioError('INVALID', 'This course has not been paid for yet');
      const { count } = await ctx.db.clPatientPackage.updateMany({ where: { id: packageId, patientId: ticket.patientId, sessionsLeft: { gt: 0 } }, data: { sessionsLeft: { decrement: 1 } } });
      if (count === 0) throw new StudioError('INVALID', 'No sessions are left on this course');
      sessionName = owned.name;
    }
    try {
      await step(ctx, ticket, ['WITH_DOCTOR'], total === 0 ? 'DONE' : 'TO_PAY', { endedAt: new Date() });
    } catch (error) {
      if (packageId) await ctx.db.clPatientPackage.updateMany({ where: { id: packageId }, data: { sessionsLeft: { increment: 1 } } });
      throw error;
    }
    // If writing the visit or the bill fails half way, the session goes back and the token returns to the doctor, so a
    // spent session never has no visit to show for it.
    try {
      const visit = await ctx.db.clVisit.create({ data: { restaurantId: ctx.restaurantId, ticketId, patientId: ticket.patientId, doctorId: ticket.doctorId, complaint: complaint ?? '', note: note ?? '' } });
      const bill = await ctx.db.clBill.create({
        data: { restaurantId: ctx.restaurantId, ticketId, patientId: ticket.patientId, doctorId: ticket.doctorId, total, status: total === 0 ? 'PAID' : 'OPEN', closedAt: total === 0 ? new Date() : null },
      });
      if (sessionName) await ctx.db.clBillLine.create({ data: { restaurantId: ctx.restaurantId, billId: bill.id, label: sessionName, amount: 0, sortOrder: -1 } });
      for (const [index, fee] of fees.entries()) await ctx.db.clBillLine.create({ data: { restaurantId: ctx.restaurantId, billId: bill.id, label: fee.label, amount: fee.amount, sortOrder: index } });
      if (ticket.bookingId) await ctx.db.clBooking.updateMany({ where: { id: ticket.bookingId }, data: { status: 'DONE' } });
      ctx.audit({ action: 'clinic.visit_recorded', entityType: 'ClVisit', entityId: visit.id, changes: { total: { before: null, after: total } } });
      return { billId: bill.id, total };
    } catch (error) {
      if (packageId) await ctx.db.clPatientPackage.updateMany({ where: { id: packageId }, data: { sessionsLeft: { increment: 1 } } });
      await ctx.db.clBill.deleteMany({ where: { ticketId } }).catch(() => undefined);
      await ctx.db.clVisit.deleteMany({ where: { ticketId } }).catch(() => undefined);
      await ctx.db.clTicket.updateMany({ where: { id: ticketId, status: { in: ['TO_PAY', 'DONE'] } }, data: { status: 'WITH_DOCTOR', endedAt: null } });
      throw error;
    }
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

/** To pay to Done for a token whose bill is already settled or has none; an open bill is settled at the cashier. */
export const finishTicket = defineClAction({
  name: 'clinic.board.finish',
  roles: [...DESK, 'CASHIER'],
  input: z.object({ ticketId: idField }),
  run: async (ctx, { ticketId }) => {
    const ticket = await ticketFor(ctx, ticketId);
    const bill = await ctx.db.clBill.findFirst({ where: { ticketId } });
    if (bill && bill.status === 'OPEN') throw new StudioError('INVALID', 'This bill is not settled');
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
        patientId: t.patientId,
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

/** The fee list of the doctor a ticket is with, for the end-of-visit panel: a doctor gets their own, the desk any ticket's. */
export const listTicketFees = defineClAction({
  name: 'clinic.board.fees',
  roles: [...DESK, 'DOCTOR'],
  input: z.object({ ticketId: idField }),
  run: async (ctx, { ticketId }) => {
    const ticket = await ticketFor(ctx, ticketId);
    const fees = await ctx.db.clDoctorFee.findMany({ where: { doctorId: ticket.doctorId }, orderBy: { sortOrder: 'asc' } });
    return fees.map((fee) => ({ feeId: fee.id, label: fee.label, amount: fee.amount }));
  },
});

/** The courses of a ticket's patient that still have sessions, for the end-of-visit panel. Names and counts only. */
export const listTicketPackages = defineClAction({
  name: 'clinic.board.packages',
  roles: [...DESK, 'DOCTOR'],
  input: z.object({ ticketId: idField }),
  run: async (ctx, { ticketId }) => {
    const ticket = await ticketFor(ctx, ticketId);
    const rows = await ctx.db.clPatientPackage.findMany({ where: { patientId: ticket.patientId, sessionsLeft: { gt: 0 } }, orderBy: { createdAt: 'asc' } });
    const unpaid = await unpaidCourseIds(ctx, rows);
    return rows.filter((p) => !unpaid.has(p.id)).map((p) => ({ patientPackageId: p.id, name: p.name, sessionsLeft: p.sessionsLeft }));
  },
});
