import { baghdadDate } from '@/server/domain/wholesale/rates';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { listPeriods } from '@/server/wholesale/period';
import { getSettings } from '@/server/wholesale/settings';
import { plain } from '@/server/wholesale/plain';
import { listOpeningImports } from '@/server/wholesale/import/opening';
import { defineQuery } from '@/server/studio/framework/query';

export const periodsQuery = defineQuery({
  name: 'wh.periods',
  permission: null,
  wh: 'period.close',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    if (!ctx.wh || !ctx.scoped) throw new Error('A wholesale query ran without a wholesale actor');
    return plain(await listPeriods(ctx.scoped, ctx.wh.restaurantId, baghdadDate()));
  },
});

export const settingsQuery = defineQuery({
  name: 'wh.settings',
  permission: null,
  wh: 'settings.manage',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    if (!ctx.scoped) throw new Error('A wholesale query ran without a wholesale actor');
    return getSettings(ctx.scoped);
  },
});

export const openingImportsQuery = defineQuery({
  name: 'wh.opening.list',
  permission: null,
  wh: 'import.apply',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    if (!ctx.wh || !ctx.scoped) throw new Error('A wholesale query ran without a wholesale actor');
    return plain(await listOpeningImports(ctx.scoped));
  },
});
