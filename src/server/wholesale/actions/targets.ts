import { z } from 'zod';
import { isMonth } from '@/server/domain/wholesale/targets';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/** A rep's targets for a month: amount in dinars, weight in kilograms, a count of pieces and per-item quantities (base unit). */

const id = z.string().min(1).max(64);
/** A positive number as text, or empty / missing for "no target of this kind". */
const goal = z
  .string()
  .trim()
  .max(24)
  .nullish()
  .transform((v) => (v === undefined || v === null || v === '' ? null : v))
  .refine((v) => v === null || (/^\d+(\.\d{1,4})?$/.test(v) && Number(v) > 0), 'a target must be a positive number');

export const setRepTargetAction = defineAction({
  name: 'wh.target.set',
  permission: null,
  wh: 'staff.manage',
  input: whPlaceInput.extend({
    userId: id,
    month: z.string().refine(isMonth, 'month must look like 2026-11'),
    amountIqd: goal,
    weightKg: goal,
    pieces: goal,
    items: z.array(z.object({ itemId: id, qty: z.string().trim().regex(/^\d+(\.\d{1,4})?$/).refine((v) => Number(v) > 0) })).max(100),
  }),
  target: whTargetOf,
  run: (ctx, { restaurantId, userId, month, amountIqd, weightKg, pieces, items }) =>
    ctx.transaction(async (tx) => {
      const rep = await tx.whStaff.findFirst({ where: { userId, role: 'REP', deactivatedAt: null }, select: { id: true } });
      if (!rep) throw new StudioError('INVALID', 'targets are for active reps only');
      const unique = [...new Map(items.map((x) => [x.itemId, x])).values()];
      const known = await tx.whItem.findMany({ where: { id: { in: unique.map((x) => x.itemId) } }, select: { id: true } });
      if (known.length !== unique.length) throw new StudioError('INVALID', 'unknown item');
      const row = await tx.whRepTarget.upsert({
        where: { restaurantId_userId_month: { restaurantId, userId, month } },
        create: { restaurantId, userId, month, amountIqd, weightKg, pieces },
        update: { amountIqd, weightKg, pieces },
        select: { id: true },
      });
      await tx.whRepItemTarget.deleteMany({ where: { targetId: row.id } });
      if (unique.length > 0) await tx.whRepItemTarget.createMany({ data: unique.map((x) => ({ restaurantId, targetId: row.id, itemId: x.itemId, qtyBase: x.qty })) });
      ctx.audit({
        action: 'wh.target.set',
        entityType: 'WhRepTarget',
        entityId: row.id,
        changes: { month: { before: null, after: month }, amountIqd: { before: null, after: amountIqd }, weightKg: { before: null, after: weightKg }, pieces: { before: null, after: pieces } },
      });
      return { id: row.id };
    }),
});
