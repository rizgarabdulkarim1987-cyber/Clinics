import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { listConversions } from '@/server/wholesale/posting/conversion';
import { getCustody, listPendingHandovers, listRepAccounts } from '@/server/wholesale/posting/custody';
import { listExpenses } from '@/server/wholesale/posting/expense';
import { plain } from '@/server/wholesale/plain';
import { defineQuery } from '@/server/studio/framework/query';

/** Reads of the treasury (Phase 5). A rep sees only his own custody and expenses. */

function who(ctx: { wh: import('@/server/wholesale/actor').WhActor | null; scoped: import('@/server/data/tenant-db').ScopedClient | null }) {
  if (!ctx.wh || !ctx.scoped) throw new Error('A wholesale query ran without a wholesale actor');
  return { user: { id: ctx.wh.userId, role: ctx.wh.role }, scoped: ctx.scoped, rid: ctx.wh.restaurantId };
}

export const conversionsQuery = defineQuery({
  name: 'wh.conversions',
  permission: null,
  wh: 'treasury.manage',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => plain(await listConversions(who(ctx).scoped)),
});

export const myCustodyQuery = defineQuery({
  name: 'wh.custody.mine',
  permission: null,
  wh: 'custody.submit',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { user, scoped, rid } = who(ctx);
    return plain(await getCustody(scoped, rid, user, user.id));
  },
});

export const pendingHandoversQuery = defineQuery({
  name: 'wh.handovers.pending',
  permission: null,
  wh: 'custody.confirm',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => plain(await listPendingHandovers(who(ctx).scoped)),
});

export const expensesQuery = defineQuery({
  name: 'wh.expenses',
  permission: null,
  wh: 'expense.submit',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { user, scoped } = who(ctx);
    return plain(await listExpenses(scoped, user));
  },
});

export const repAccountsQuery = defineQuery({
  name: 'wh.custody.reps',
  permission: null,
  wh: 'custody.confirm',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { user, scoped, rid } = who(ctx);
    return plain(await listRepAccounts(scoped, rid, user));
  },
});
