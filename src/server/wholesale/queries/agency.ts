import { z } from 'zod';
import { agencyExport, getAgencyOrder, listAgencyOrders } from '@/server/wholesale/posting/agency';
import { plain } from '@/server/wholesale/plain';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { defineQuery } from '@/server/studio/framework/query';

/** Reads of agency orders (owner and partner only). Plain text and numbers leave the server. */

function who(ctx: { wh: import('@/server/wholesale/actor').WhActor | null; scoped: import('@/server/data/tenant-db').ScopedClient | null }) {
  if (!ctx.wh || !ctx.scoped) throw new Error('A wholesale query ran without a wholesale actor');
  return { user: { id: ctx.wh.userId, role: ctx.wh.role }, scoped: ctx.scoped };
}

export const agencyOrdersQuery = defineQuery({
  name: 'wh.agency.list',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { user, scoped } = who(ctx);
    return plain(await listAgencyOrders(scoped, user));
  },
});

export const agencyOrderQuery = defineQuery({
  name: 'wh.agency.get',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ id: z.string().min(1).max(64) }),
  target: whTargetOf,
  run: async (ctx, { id }) => {
    const { user, scoped } = who(ctx);
    const order = await getAgencyOrder(scoped, user, id);
    return order ? plain(order) : null;
  },
});

export const agencyExportQuery = defineQuery({
  name: 'wh.agency.export',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  target: whTargetOf,
  run: async (ctx, { from, to }) => plain(await agencyExport(who(ctx).scoped, from, to)),
});
