import { z } from 'zod';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { addDays } from '@/server/domain/wholesale/forecast';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { listPendingHandovers } from '@/server/wholesale/posting/custody';
import { listExpenses } from '@/server/wholesale/posting/expense';
import { cashPosition, debts, lowStock, partyBalances, profit, salesByDay, stockValue } from '@/server/wholesale/posting/reports';
import { listPendingSales } from '@/server/wholesale/posting/sale';
import { plain } from '@/server/wholesale/plain';
import { assistantUsed } from '@/server/wholesale/assistant';
import { defineQuery } from '@/server/studio/framework/query';

/** Reports and the home screen (Phase 6). Partners only: a rep never sees cost, profit or the company's cash. */

function scoped(ctx: { wh: import('@/server/wholesale/actor').WhActor | null; scoped: import('@/server/data/tenant-db').ScopedClient | null }) {
  if (!ctx.wh || !ctx.scoped) throw new Error('A wholesale query ran without a wholesale actor');
  return { db: ctx.scoped, user: { id: ctx.wh.userId, role: ctx.wh.role } };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Everything the home screen shows in one read, so it can refresh as one. */
export const dashboardQuery = defineQuery({
  name: 'wh.dashboard',
  permission: null,
  wh: 'report.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { db, user } = scoped(ctx);
    const today = baghdadDate();
    const monthStart = `${today.slice(0, 7)}-01`;
    const [position, owed, month, todaySales, week, stock, pendingSales, pendingHandovers, pendingExpenses] = await Promise.all([
      cashPosition(db),
      debts(db),
      profit(db, { from: monthStart, to: today }),
      salesByDay(db, { from: today, to: today }),
      salesByDay(db, { from: addDays(today, -6), to: today }),
      stockValue(db),
      listPendingSales(db),
      listPendingHandovers(db),
      listExpenses(db, user, 'PENDING'),
    ]);
    return plain({
      date: today,
      cash: position.cash,
      repCustody: position.repCustody,
      receivable: owed.receivable,
      payable: owed.payable,
      monthProfit: month,
      todaySales: todaySales[0] ?? { date: today, iqd: '0', count: 0 },
      week,
      stockValueIqd: stock.totalIqd,
      lowStock: lowStock(stock.rows).slice(0, 6),
      pending: { sales: pendingSales.length, handovers: pendingHandovers.length, expenses: pendingExpenses.length },
    });
  },
});

export const profitReportQuery = defineQuery({
  name: 'wh.report.profit',
  permission: null,
  wh: 'report.view',
  input: whPlaceInput.extend({ from: isoDate, to: isoDate }),
  target: whTargetOf,
  run: async (ctx, { from, to }) => {
    const { db } = scoped(ctx);
    const [p, days] = await Promise.all([profit(db, { from, to }), salesByDay(db, { from, to })]);
    return plain({ profit: p, days });
  },
});

export const stockReportQuery = defineQuery({
  name: 'wh.report.stock',
  permission: null,
  wh: 'report.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => plain(await stockValue(scoped(ctx).db)),
});

export const debtorsReportQuery = defineQuery({
  name: 'wh.report.debtors',
  permission: null,
  wh: 'report.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { db } = scoped(ctx);
    const [customers, suppliers] = await Promise.all([partyBalances(db, 'AR'), partyBalances(db, 'AP')]);
    return plain({ customers, suppliers });
  },
});

/** How many assistant questions this month has used. */
export const assistantUsageQuery = defineQuery({
  name: 'wh.assistant.usage',
  permission: null,
  wh: 'ai.use',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => ({ used: await assistantUsed(scoped(ctx).db) }),
});

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
type Money = Record<string, string>;
const addTo = (m: Record<string, number>, cur: string, v: { toString(): string }) => {
  m[cur] = (m[cur] ?? 0) + Number(v.toString());
};
const fixed = (m: Record<string, number>): Money => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(Math.round(v * 10000) / 10000)]));

/** Posted sales of a range by customer and by item, in the currencies they were sold in (before returns). */
export const salesBreakdownQuery = defineQuery({
  name: 'wh.report.sales',
  permission: null,
  wh: 'report.view',
  input: whPlaceInput.extend({ from: isoDate, to: isoDate }),
  target: whTargetOf,
  run: async (ctx, { from, to }) => {
    const { db } = scoped(ctx);
    const range = { gte: toDate(from), lte: toDate(to) };
    const [sales, lines] = await Promise.all([
      db.whSale.findMany({ where: { status: 'POSTED', date: range }, select: { currency: true, totalFinal: true, customer: { select: { id: true, name: true } } }, take: 20000 }),
      db.whSaleLine.findMany({ where: { sale: { status: 'POSTED', date: range } }, select: { qtyBase: true, lineTotal: true, item: { select: { id: true, code: true, names: true, baseUnit: true } }, sale: { select: { currency: true } } }, take: 50000 }),
    ]);
    const cust = new Map<string, { name: string; count: number; by: Record<string, number> }>();
    for (const s of sales) {
      const e = cust.get(s.customer.id) ?? { name: s.customer.name, count: 0, by: {} };
      e.count += 1;
      addTo(e.by, s.currency, s.totalFinal);
      cust.set(s.customer.id, e);
    }
    const item = new Map<string, { code: string; names: unknown; baseUnit: string; qty: number; by: Record<string, number> }>();
    for (const l of lines) {
      const e = item.get(l.item.id) ?? { code: l.item.code, names: l.item.names, baseUnit: l.item.baseUnit as string, qty: 0, by: {} };
      e.qty += Number(l.qtyBase.toString());
      addTo(e.by, l.sale.currency, l.lineTotal);
      item.set(l.item.id, e);
    }
    const weight = (by: Record<string, number>) => Object.values(by).reduce((a, b) => a + b, 0);
    return plain({
      customers: [...cust.values()].sort((a, b) => weight(b.by) - weight(a.by)).slice(0, 200).map((e) => ({ name: e.name, count: e.count, byCurrency: fixed(e.by) })),
      items: [...item.values()].sort((a, b) => weight(b.by) - weight(a.by)).slice(0, 200).map((e) => ({ code: e.code, names: e.names, baseUnit: e.baseUnit, qty: String(Math.round(e.qty * 10000) / 10000), byCurrency: fixed(e.by) })),
    });
  },
});

/** Posted expenses of a range by category, in the currencies they were paid in. */
export const expensesReportQuery = defineQuery({
  name: 'wh.report.expenses',
  permission: null,
  wh: 'report.view',
  input: whPlaceInput.extend({ from: isoDate, to: isoDate }),
  target: whTargetOf,
  run: async (ctx, { from, to }) => {
    const { db } = scoped(ctx);
    const rows = await db.whExpense.findMany({ where: { status: 'POSTED', date: { gte: toDate(from), lte: toDate(to) } }, select: { category: true, currency: true, amount: true }, take: 50000 });
    const by = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const m = by.get(r.category) ?? {};
      addTo(m, r.currency, r.amount);
      by.set(r.category, m);
    }
    return plain([...by.entries()].map(([category, m]) => ({ category, byCurrency: fixed(m) })));
  },
});
