import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction } from '../framework';

/** The appointment kinds a patient can book, with the time each takes. The owner edits; the receptionist reads. */

const serviceFields = {
  name: z.string().trim().min(1, 'Enter the service’s name').max(80),
  durationMin: z
    .number()
    .int()
    .min(5)
    .max(240)
    .refine((minutes) => minutes % 5 === 0, 'Use whole steps of five minutes'),
  depositAmount: z.number().int().min(0).max(1_000_000_000),
  active: z.boolean(),
};

export const listServices = defineClAction({
  name: 'clinic.services.list',
  roles: ['OWNER', 'RECEPTION'],
  input: z.object({}),
  run: async (ctx) => {
    const rows = await ctx.db.clService.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((s) => ({ serviceId: s.id, name: s.name, durationMin: s.durationMin, depositAmount: s.depositAmount, active: s.active }));
  },
});

export const saveService = defineClAction({
  name: 'clinic.services.save',
  roles: ['OWNER'],
  input: z.object({ serviceId: z.string().min(1).max(64).optional(), ...serviceFields }),
  run: async (ctx, { serviceId, name, durationMin, depositAmount, active }) => {
    if (serviceId === undefined) {
      const made = await ctx.db.clService.create({ data: { restaurantId: ctx.restaurantId, name, durationMin, depositAmount, active } });
      ctx.audit({ action: 'clinic.service_saved', entityType: 'ClService', entityId: made.id, changes: { name: { before: null, after: name } } });
      return { serviceId: made.id };
    }
    const row = await ctx.db.clService.findFirst({ where: { id: serviceId } });
    if (!row) throw new StudioError('NOT_FOUND');
    await ctx.db.clService.update({ where: { id: serviceId }, data: { name, durationMin, depositAmount, active } });
    ctx.audit({
      action: 'clinic.service_saved',
      entityType: 'ClService',
      entityId: serviceId,
      changes: { name: { before: row.name, after: name }, durationMin: { before: row.durationMin, after: durationMin }, active: { before: row.active, after: active } },
    });
    return { serviceId };
  },
});
