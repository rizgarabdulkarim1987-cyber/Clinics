import { z } from 'zod';
import { listCustomers } from '@/server/wholesale/catalog';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { customerStatement, getSale, listPendingSales, listSales, receivables, saleWarehouses } from '@/server/wholesale/posting/sale';
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

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const salesQuery = defineQuery({
  name: 'wh.sales',
  permission: null,
  wh: 'sale.create',
  input: whPlaceInput.extend({ from: day.optional(), to: day.optional(), sellerId: z.string().max(64).optional() }),
  target: whTargetOf,
  run: async (ctx, input) => {
    const { user, scoped } = who(ctx);
    return plain(await listSales(scoped, user, { from: input.from, to: input.to, sellerId: input.sellerId }));
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

/**
 * Who owes what and by when: for each customer (a rep: his own) the open amount per currency and the earliest due date among
 * the sales still open. Settled customers are left out; overdue ones come first, then by due date.
 */
export const debtsListQuery = defineQuery({
  name: 'wh.debts.list',
  permission: null,
  wh: 'sale.create',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { user, scoped } = who(ctx);
    const rid = ctx.wh!.restaurantId;
    const today = baghdadDate();
    const customers = await listCustomers(scoped, rid, { role: user.role, userId: user.id });
    const rows = await Promise.all(
      customers.map(async (c) => {
        const open = (await receivables(scoped, rid, c.id)).filter((d) => d.open.gt(0));
        if (open.length === 0) return null;
        const totals: Record<string, string> = {};
        for (const d of open) totals[d.currency] = (totals[d.currency] ? Number(totals[d.currency]) + Number(d.open.toFixed()) : Number(d.open.toFixed())).toString();
        const dues = open.map((d) => d.dueDate).filter((x): x is string => !!x).sort();
        const due = dues[0] ?? null;
        const invoices = open.map((d) => ({ id: d.id, number: d.number === null ? null : Number(d.number), date: d.date, due: d.dueDate, currency: d.currency as string, amount: d.amount.toFixed(), open: d.open.toFixed() }));
        return { id: c.id, name: c.name, phone: c.phone ?? null, totals, due, overdue: due !== null && due < today, invoices };
      }),
    );
    const list = rows.filter((r): r is NonNullable<typeof r> => r !== null);
    list.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.name.localeCompare(b.name));
    return plain({ today, rows: list });
  },
});

/** Today's dollar and toman rates (dinars per unit) for the sell screen's conversion line. A rep can read them: no cost in them. */
export const dayRatesQuery = defineQuery({
  name: 'wh.dayRates',
  permission: null,
  wh: 'sale.create',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { scoped } = who(ctx);
    const rows = await scoped.whExchangeRate.findMany({ where: { date: new Date(`${baghdadDate()}T00:00:00Z`) } });
    return { USD: rows.find((r) => r.currency === 'USD')?.iqdPer.toFixed() ?? null, IRT: rows.find((r) => r.currency === 'IRT')?.iqdPer.toFixed() ?? null };
  },
});
