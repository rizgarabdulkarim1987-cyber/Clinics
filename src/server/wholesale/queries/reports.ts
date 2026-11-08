import { z } from 'zod';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { addDays } from '@/server/domain/wholesale/forecast';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { listPendingHandovers } from '@/server/wholesale/posting/custody';
import { listExpenses } from '@/server/wholesale/posting/expense';
import { cashPosition, debts, lowStock, partyBalances, profit, salesByDay, stockValue } from '@/server/wholesale/posting/reports';
import { listPendingSales } from '@/server/wholesale/posting/sale';
import { plain } from '@/server/wholesale/plain';
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
