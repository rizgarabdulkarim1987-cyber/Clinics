import { z } from 'zod';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';

/**
 * A clinic's settings, on the Studio side. Any Super Admin (`platform.settings`) changes them; a clinic's own owner does
 * not, here. A business without a `ClSettings` row is not a clinic: not found, so nothing is written through this
 * action to a business of another project.
 */

const atRestaurant = (restaurantId: string) => ({ kind: 'restaurant', restaurantId }) as const;

function restaurantOf(ctx: ActionContext): string {
  if (ctx.restaurantId === null) throw new Error('A clinic action ran without a restaurant');
  return ctx.restaurantId;
}

export const updateClinicSettings = defineAction({
  name: 'clinic.updateSettings',
  permission: 'platform.settings',
  input: z.object({
    restaurantId: z.string().min(1).max(100),
    /** Whether a doctor's clinical note may be read by the clinic's other doctors. */
    sharePrivateNotes: z.boolean(),
    version: z.number().int().positive(),
  }),
  target: (input) => atRestaurant(input.restaurantId),
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const restaurantId = restaurantOf(ctx);
      const settings = await tx.clSettings.findUnique({ where: { restaurantId }, select: { id: true, sharePrivateNotes: true, version: true } });
      if (!settings) throw new StudioError('NOT_FOUND');
      if (settings.sharePrivateNotes === input.sharePrivateNotes) return { version: settings.version };
      await updateWithVersion(tx.clSettings, { id: settings.id, version: input.version, data: { sharePrivateNotes: input.sharePrivateNotes }, entityType: 'ClSettings' }, tx);
      ctx.audit({
        action: 'clinic.settings_changed',
        entityType: 'ClSettings',
        entityId: restaurantId,
        changes: { sharePrivateNotes: { before: settings.sharePrivateNotes, after: input.sharePrivateNotes } },
      });
      return { version: input.version + 1 };
    }),
});
