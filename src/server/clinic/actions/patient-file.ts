import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction } from '../framework';
import { localMinutes } from '../time';

/**
 * A patient's file. The desk's side holds money and appointments only (visits with what was billed and paid, what is
 * booked, courses left, what is owed, stamps, missed appointments): no complaint and no note, so nothing clinical reaches
 * the receptionist. The clinical alert (an allergy, a chronic condition) is one short text, written and read by doctors
 * alone, kept out of the audit log, and refused in a beauty centre, which keeps no clinical text.
 */

const idField = z.string().min(1).max(64);
const MAX_ALERT = 300;
const pad = (n: number) => String(n).padStart(2, '0');

export const getPatientFile = defineClAction({
  name: 'clinic.patientFile.get',
  roles: ['OWNER', 'RECEPTION'],
  input: z.object({ patientId: idField }),
  run: async (ctx, { patientId }) => {
    const patient = await ctx.db.clPatient.findFirst({ where: { id: patientId }, select: { id: true, householdId: true } });
    if (!patient) throw new StudioError('NOT_FOUND');
    const [bills, upcoming, packages, debts, stamps, noShows] = await Promise.all([
      ctx.db.clBill.findMany({
        where: { patientId },
        select: { id: true, total: true, paid: true, status: true, ticket: { select: { day: true } }, doctor: { select: { member: { select: { account: { select: { name: true } } } } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      ctx.db.clBooking.findMany({
        where: { patientId, status: 'BOOKED', startsAt: { gte: new Date() } },
        select: { id: true, startsAt: true, doctor: { select: { member: { select: { account: { select: { name: true } } } } } } },
        orderBy: { startsAt: 'asc' },
        take: 20,
      }),
      ctx.db.clPatientPackage.findMany({ where: { patientId, sessionsLeft: { gt: 0 } }, select: { name: true, sessionsLeft: true }, orderBy: { createdAt: 'asc' } }),
      ctx.db.clBill.findMany({ where: { patientId, status: 'DEBT' }, select: { total: true, paid: true } }),
      ctx.db.clLoyaltyEntry.aggregate({ where: { householdId: patient.householdId }, _sum: { delta: true } }),
      ctx.db.clBooking.count({ where: { patientId, status: 'NO_SHOW' } }),
    ]);
    return {
      visits: bills.map((b) => ({ billId: b.id, day: b.ticket.day, doctorName: b.doctor.member.account.name, total: b.total, paid: b.paid, status: b.status })),
      upcoming: upcoming.map((b) => ({ bookingId: b.id, startsAt: b.startsAt.toISOString(), time: `${pad(Math.floor(localMinutes(b.startsAt) / 60))}:${pad(localMinutes(b.startsAt) % 60)}`, doctorName: b.doctor.member.account.name })),
      packages,
      debt: debts.reduce((sum, b) => sum + (b.total - b.paid), 0),
      stamps: stamps._sum.delta ?? 0,
      noShows,
    };
  },
});

export const getPatientAlert = defineClAction({
  name: 'clinic.patientFile.getAlert',
  roles: ['DOCTOR'],
  input: z.object({ patientId: idField }),
  run: async (ctx, { patientId }) => {
    if (ctx.account.space === 'BEAUTY') throw new StudioError('FORBIDDEN');
    const row = await ctx.db.clPatientAlert.findFirst({ where: { patientId }, select: { text: true } });
    if (row) ctx.audit({ action: 'clinic.alert_read', entityType: 'ClPatient', entityId: patientId, changes: {} });
    return { text: row?.text ?? '' };
  },
});

export const savePatientAlert = defineClAction({
  name: 'clinic.patientFile.saveAlert',
  roles: ['DOCTOR'],
  input: z.object({ patientId: idField, text: z.string().max(MAX_ALERT) }),
  run: async (ctx, { patientId, text }) => {
    if (ctx.account.space === 'BEAUTY') throw new StudioError('FORBIDDEN');
    const patient = await ctx.db.clPatient.findFirst({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new StudioError('NOT_FOUND');
    const value = text.trim();
    const existing = await ctx.db.clPatientAlert.findFirst({ where: { patientId }, select: { id: true } });
    if (value === '') {
      if (existing) await ctx.db.clPatientAlert.deleteMany({ where: { patientId } });
    } else if (existing) {
      await ctx.db.clPatientAlert.updateMany({ where: { patientId }, data: { text: value, updatedById: ctx.member.memberId } });
    } else {
      await ctx.db.clPatientAlert.create({ data: { restaurantId: ctx.restaurantId, patientId, text: value, updatedById: ctx.member.memberId } });
    }
    // The words are clinical: the audit row says only that an alert was set or cleared.
    ctx.audit({ action: 'clinic.alert_saved', entityType: 'ClPatient', entityId: patientId, changes: { alert: { before: existing ? 'set' : null, after: value === '' ? null : 'set' } } });
    return null;
  },
});
