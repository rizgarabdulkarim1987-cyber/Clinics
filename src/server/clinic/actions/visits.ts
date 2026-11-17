import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction, type ClContext } from '../framework';

/**
 * Reading a doctor's visit notes. Only a doctor reads them, and only their own unless the clinic has switched on
 * `sharePrivateNotes`; the owner, the receptionist and the cashier are refused outright. Every read leaves an audit row
 * that names the visit or the patient by id and never carries the text.
 */

const idField = z.string().min(1).max(64);

async function readScope(ctx: ClContext) {
  const own = (await ctx.db.clDoctor.findFirst({ where: { memberId: ctx.member.memberId }, select: { id: true } }))?.id ?? null;
  const shared = (await ctx.db.clSettings.findFirst({}))?.sharePrivateNotes ?? false;
  return { own, shared };
}

export const getVisit = defineClAction({
  name: 'clinic.visits.get',
  roles: ['DOCTOR'],
  input: z.object({ ticketId: idField }),
  run: async (ctx, { ticketId }) => {
    const visit = await ctx.db.clVisit.findFirst({ where: { ticketId } });
    if (!visit) throw new StudioError('NOT_FOUND');
    const { own, shared } = await readScope(ctx);
    if (visit.doctorId !== own && !shared) throw new StudioError('NOT_FOUND');
    ctx.audit({ action: 'clinic.visit_read', entityType: 'ClVisit', entityId: visit.id, changes: {} });
    return { visitId: visit.id, doctorId: visit.doctorId, complaint: visit.complaint, note: visit.note, createdAt: visit.createdAt.toISOString() };
  },
});

export const listPatientVisits = defineClAction({
  name: 'clinic.visits.listForPatient',
  roles: ['DOCTOR'],
  input: z.object({ patientId: idField }),
  run: async (ctx, { patientId }) => {
    const { own, shared } = await readScope(ctx);
    const rows = await ctx.db.clVisit.findMany({
      where: { patientId, ...(shared ? {} : { doctorId: own ?? '-' }) },
      include: { doctor: { select: { member: { select: { account: { select: { name: true } } } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (rows.length > 0) ctx.audit({ action: 'clinic.visit_read', entityType: 'ClPatient', entityId: patientId, changes: {} });
    return rows.map((v) => ({ visitId: v.id, doctorName: v.doctor.member.account.name, complaint: v.complaint, note: v.note, createdAt: v.createdAt.toISOString() }));
  },
});
