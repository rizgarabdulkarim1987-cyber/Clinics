import { z } from 'zod';
import { CREDIT_LIMIT_MODES, InvalidSettingError, SETTING_CURRENCIES } from '@/server/domain/wholesale/settings';
import { refusingBooks } from '@/server/wholesale/actions/purchase';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { closePeriod, reopenPeriod } from '@/server/wholesale/period';
import { setSettingTx } from '@/server/wholesale/settings';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/** Closing and reopening a month, and the company's settings (Phase 5). */

const month = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

async function refusing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await refusingBooks(fn);
  } catch (error) {
    if (error instanceof InvalidSettingError) throw new StudioError('INVALID', error.message);
    throw error;
  }
}

export const closePeriodAction = defineAction({
  name: 'wh.period.close',
  permission: null,
  wh: 'period.close',
  input: whPlaceInput.extend({ month }),
  target: whTargetOf,
  run: (ctx, { restaurantId, month: m }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        await closePeriod(tx, restaurantId, { id: ctx.wh!.userId }, m);
        ctx.audit({ action: 'wh.period.close', entityType: 'WhPeriod', entityId: m, changes: {} });
        return { ok: true as const };
      }),
    ),
});

export const reopenPeriodAction = defineAction({
  name: 'wh.period.reopen',
  permission: null,
  wh: 'period.close',
  input: whPlaceInput.extend({ month }),
  target: whTargetOf,
  run: (ctx, { restaurantId, month: m }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        await reopenPeriod(tx, restaurantId, { id: ctx.wh!.userId }, m);
        ctx.audit({ action: 'wh.period.reopen', entityType: 'WhPeriod', entityId: m, changes: {} });
        return { ok: true as const };
      }),
    ),
});

export const saveSettingsAction = defineAction({
  name: 'wh.settings.save',
  permission: null,
  wh: 'settings.manage',
  input: whPlaceInput.extend({
    requireApproval: z.boolean(),
    creditLimitMode: z.enum(CREDIT_LIMIT_MODES),
    defaultCurrency: z.enum(SETTING_CURRENCIES),
    expiryAlertDays: z.number().int().min(1).max(365),
  }),
  target: whTargetOf,
  run: (ctx, { restaurantId, ...values }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        for (const [key, value] of Object.entries(values)) await setSettingTx(tx, restaurantId, ctx.wh!.userId, key as 'requireApproval', value as never);
        ctx.audit({ action: 'wh.settings.save', entityType: 'WhSetting', entityId: restaurantId, changes: {} });
        return { ok: true as const };
      }),
    ),
});
