import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { createTicket } from '../booking/tickets';
import { defineClAction } from '../framework';
import { localDay } from '../time';

/**
 * Courses. The owner defines a course (a name, a number of sessions, a price); the desk sells one to a patient. A sale
 * is a token in "To pay" with a one-line bill, so it is paid, left as a debt and counted like any bill; it is not a
 * visit. Sessions are spent when a visit ends (see `endVisit` with `packageId`). No clinical text is read here.
 */

const DESK = ['OWNER', 'RECEPTION'] as const;
const idField = z.string().min(1).max(64);

export const listPackages = defineClAction({
  name: 'clinic.packages.list',
  roles: [...DESK],
  input: z.object({}),
  run: async (ctx) => {
    const rows = await ctx.db.clPackage.findMany({ where: ctx.member.role === 'OWNER' ? {} : { active: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((p) => ({ packageId: p.id, name: p.name, sessions: p.sessions, price: p.price, active: p.active }));
  },
});

export const savePackage = defineClAction({
  name: 'clinic.packages.save',
  roles: ['OWNER'],
  input: z.object({
    packageId: idField.optional(),
    name: z.string().trim().min(1, 'Enter the course’s name').max(80),
    sessions: z.number().int().min(1).max(100),
    price: z.number().int().min(0).max(1_000_000_000),
    active: z.boolean(),
  }),
  run: async (ctx, { packageId, name, sessions, price, active }) => {
    if (packageId) {
      const { count } = await ctx.db.clPackage.updateMany({ where: { id: packageId }, data: { name, sessions, price, active } });
      if (count === 0) throw new StudioError('NOT_FOUND');
      ctx.audit({ action: 'clinic.package_saved', entityType: 'ClPackage', entityId: packageId, changes: {} });
      return { packageId };
    }
    const row = await ctx.db.clPackage.create({ data: { restaurantId: ctx.restaurantId, name, sessions, price, active } });
    ctx.audit({ action: 'clinic.package_saved', entityType: 'ClPackage', entityId: row.id, changes: {} });
    return { packageId: row.id };
  },
});

export const sellPackage = defineClAction({
  name: 'clinic.packages.sell',
  roles: [...DESK],
  input: z.object({ patientId: idField, packageId: idField, doctorId: idField }),
  run: async (ctx, { patientId, packageId, doctorId }) => {
    const patient = await ctx.db.clPatient.findFirst({ where: { id: patientId } });
    const pack = await ctx.db.clPackage.findFirst({ where: { id: packageId, active: true } });
    const doctor = await ctx.db.clDoctor.findFirst({ where: { id: doctorId, active: true, member: { status: 'ACTIVE' } } });
    if (!patient || !pack || !doctor) throw new StudioError('NOT_FOUND');
    // A double tap must not sell the same course twice: a repeat within moments is refused.
    const justSold = await ctx.db.clPatientPackage.findFirst({ where: { patientId, packageId, createdAt: { gte: new Date(Date.now() - 30_000) } }, select: { id: true } });
    if (justSold) throw new StudioError('INVALID', 'This course was just sold to this patient');
    const free = pack.price === 0;
    const ticket = await createTicket(ctx.db, { restaurantId: ctx.restaurantId, day: localDay(new Date()), patientId, doctorId, status: free ? 'DONE' : 'TO_PAY' });
    const bill = await ctx.db.clBill.create({
      data: { restaurantId: ctx.restaurantId, ticketId: ticket.id, patientId, doctorId, total: pack.price, status: free ? 'PAID' : 'OPEN', closedAt: free ? new Date() : null },
    });
    await ctx.db.clBillLine.create({ data: { restaurantId: ctx.restaurantId, billId: bill.id, label: pack.name, amount: pack.price, sortOrder: 0 } });
    const owned = await ctx.db.clPatientPackage.create({
      data: { restaurantId: ctx.restaurantId, packageId, patientId, billId: bill.id, name: pack.name, sessionsTotal: pack.sessions, sessionsLeft: pack.sessions },
    });
    ctx.audit({ action: 'clinic.package_sold', entityType: 'ClPatientPackage', entityId: owned.id, changes: { total: { before: null, after: pack.price } } });
    return { billId: bill.id, patientPackageId: owned.id };
  },
});
