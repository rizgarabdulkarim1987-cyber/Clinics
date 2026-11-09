import { z } from 'zod';
import { CREDIT_LIMIT_MODES, InvalidSettingError, SETTING_CURRENCIES } from '@/server/domain/wholesale/settings';
import { refusingBooks } from '@/server/wholesale/actions/purchase';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { closePeriod, reopenPeriod } from '@/server/wholesale/period';
import { importOpeningTx, OpeningImportError, OPENING_KINDS } from '@/server/wholesale/import/opening';
import { setSettingTx } from '@/server/wholesale/settings';
import { InvalidStockError } from '@/server/domain/wholesale/costing';
import { postStockCountTx } from '@/server/wholesale/stockCount';
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

/** Opening balances (Phase 8): one kind of CSV at a time. A file with any problem writes nothing and comes back with its row errors. */
class OpeningRejected extends Error {
  constructor(readonly errors: { row: number; message: string }[]) {
    super('opening import rejected');
  }
}

export const importOpeningAction = defineAction({
  name: 'wh.opening.import',
  permission: null,
  wh: 'import.apply',
  input: whPlaceInput.extend({ kind: z.enum(OPENING_KINDS), csv: z.string().min(1).max(2_000_000), date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  target: whTargetOf,
  run: async (ctx, { restaurantId, kind, csv, date }) => {
    try {
      return await ctx.transaction(async (tx) =>
        refusing(async () => {
          try {
            const r = await importOpeningTx(tx, restaurantId, { id: ctx.wh!.userId, role: ctx.wh!.role }, csv, kind, { date });
            if (r.errors.length > 0) throw new OpeningRejected(r.errors);
            ctx.audit({ action: 'wh.opening.import', entityType: 'WhOpeningImport', entityId: r.importId ?? kind, changes: { kind: { before: null, after: kind }, rows: { before: null, after: r.imported } } });
            return { ok: true as const, imported: r.imported, totalIqd: r.totalIqd ?? '0', errors: [] as { row: number; message: string }[] };
          } catch (error) {
            if (error instanceof OpeningImportError) throw new StudioError('INVALID', error.message);
            throw error;
          }
        }),
      );
    } catch (error) {
      if (error instanceof OpeningRejected) return { ok: false as const, imported: 0, totalIqd: '0', errors: error.errors };
      throw error;
    }
  },
});

/** A stock count of one warehouse (Phase 8): only the items counted are sent; the difference is posted at once. */
export const postStockCountAction = defineAction({
  name: 'wh.stockcount.post',
  permission: null,
  wh: 'stock.count',
  input: whPlaceInput.extend({
    warehouseId: z.string().min(1).max(64),
    counts: z
      .array(z.object({ itemId: z.string().min(1).max(64), countedBase: z.string().trim().min(1).max(40), unitCostIqd: z.string().trim().max(40).optional(), expiry: z.string().trim().max(10).optional() }))
      .min(1)
      .max(2000),
  }),
  target: whTargetOf,
  run: (ctx, { restaurantId, warehouseId, counts }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        try {
          const r = await postStockCountTx(tx, restaurantId, { id: ctx.wh!.userId, role: ctx.wh!.role }, { warehouseId, counts });
          ctx.audit({ action: 'wh.stockcount.post', entityType: 'WhStockCount', entityId: r.countId, changes: { differences: { before: null, after: r.differences } } });
          return { ok: true as const, differences: r.differences };
        } catch (error) {
          if (error instanceof InvalidStockError) throw new StudioError('INVALID', error.message);
          throw error;
        }
      }),
    ),
});
