import { z } from 'zod';
import { customerStatement, getSale, listPendingSales, listSales, saleWarehouses } from '@/server/wholesale/posting/sale';
import { plain } from '@/server/wholesale/plain';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reads of the sales side (Phase 4). A rep's lists hold only his own customers' sales and his own warehouse; the cost fields are
 * not even selected for him. Everything leaves the server as plain text and numbers.
 */

function who(ctx: { wh: import('@/server/wholesale/actor').WhActor | null; scoped: import('@/server/data/tenant-db').ScopedClient | null }) {
  if (!ctx.wh || !ctx.scoped) throw new Error('A wholesale query ran without a wholesale actor');
  return { user: { id: ctx.wh.userId, role: ctx.wh.role }, scoped: ctx.scoped };
}

const idInput = whPlaceInput.extend({ id: z.string().min(1).max(64) });

export const salesQuery = defineQuery({
  name: 'wh.sales',
  permission: null,
  wh: 'sale.create',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { user, scoped } = who(ctx);
    return plain(await listSales(scoped, user));
  },
});

export const pendingSalesQuery = defineQuery({
  name: 'wh.sales.pending',
  permission: null,
  wh: 'sale.override',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => plain(await listPendingSales(who(ctx).scoped)),
});

export const saleQuery = defineQuery({
  name: 'wh.sale',
  permission: null,
  wh: 'sale.create',
  input: idInput,
  target: whTargetOf,
  run: async (ctx, { id }) => {
    const { user, scoped } = who(ctx);
    const sale = await getSale(scoped, user, id);
    return sale ? plain(sale) : null;
  },
});

export const saleWarehousesQuery = defineQuery({
  name: 'wh.sale.warehouses',
  permission: null,
  wh: 'sale.create',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { user, scoped } = who(ctx);
    return saleWarehouses(scoped, user);
  },
});

export const customerStatementQuery = defineQuery({
  name: 'wh.customer.statement',
  permission: null,
  wh: 'sale.create',
  input: idInput,
  target: whTargetOf,
  run: async (ctx, { id }) => {
    const { user, scoped } = who(ctx);
    return plain(await customerStatement(scoped, user, id));
  },
});
