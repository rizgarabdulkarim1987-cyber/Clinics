import { z } from 'zod';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { addDays } from '@/server/domain/wholesale/forecast';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { getCustody, listPendingHandovers } from '@/server/wholesale/posting/custody';
import { listExpenses } from '@/server/wholesale/posting/expense';
import { cashPosition, debts, lowStock, partyBalances, profit, salesByDay, stockValue } from '@/server/wholesale/posting/reports';
import { listPendingSales, receivables } from '@/server/wholesale/posting/sale';
import { computeAlerts, ODD_PRICE_WINDOW_DAYS, SALES_DROP_TRAILING_DAYS } from '@/server/domain/wholesale/alerts';
import { D } from '@/server/domain/wholesale/money';
import { canWh } from '@/server/domain/wholesale/permissions';
import { daysUntil, expiryStatus } from '@/server/domain/wholesale/expiry';
import { listCustomers } from '@/server/wholesale/catalog';
import { activeDaysOf, dailyRate, daysOfCover, reorderBy } from '@/server/domain/wholesale/forecast';
import { getSettings } from '@/server/wholesale/settings';
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
    const yearAgo = new Date(`${monthStart}T00:00:00Z`);
    yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 11);
    const [position, owed, month, todaySales, week, stock, pendingSales, pendingHandovers, pendingExpenses, year] = await Promise.all([
      cashPosition(db),
      debts(db),
      profit(db, { from: monthStart, to: today }),
      salesByDay(db, { from: today, to: today }),
      salesByDay(db, { from: addDays(today, -6), to: today }),
      stockValue(db),
      listPendingSales(db),
      listPendingHandovers(db),
      listExpenses(db, user, 'PENDING'),
      salesByDay(db, { from: yearAgo.toISOString().slice(0, 10), to: today }),
    ]);
    const perMonth = new Map<string, number>();
    for (const d of year) perMonth.set(d.date.slice(0, 7), (perMonth.get(d.date.slice(0, 7)) ?? 0) + Number(d.iqd));
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = new Date(yearAgo);
      m.setUTCMonth(m.getUTCMonth() + i);
      const key = m.toISOString().slice(0, 7);
      return { month: key, iqd: String(perMonth.get(key) ?? 0) };
    });
    return plain({
      date: today,
      months,
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

/** What needs a partner's eye: customers late on a debt, a day of weak sales, a sale far under the list price. Plain rules, no AI. */
export const alertsQuery = defineQuery({
  name: 'wh.alerts',
  permission: null,
  wh: 'report.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { db } = scoped(ctx);
    const rid = ctx.wh!.restaurantId;
    const today = baghdadDate();
    const [debtors, week, lines] = await Promise.all([
      partyBalances(db, 'AR'),
      salesByDay(db, { from: addDays(today, -SALES_DROP_TRAILING_DAYS), to: today }),
      db.whSaleLine.findMany({
        where: { sale: { status: 'POSTED', date: { gte: new Date(`${addDays(today, -(ODD_PRICE_WINDOW_DAYS - 1))}T00:00:00Z`) } } },
        select: { id: true, saleId: true, itemId: true, officialPrice: true, finalPrice: true, sale: { select: { date: true, currency: true } } },
        take: 5000,
      }),
    ]);
    const receivable: import('@/server/domain/wholesale/alerts').ReceivableAlertRow[] = [];
    for (const d of debtors.slice(0, 100)) {
      for (const r of await receivables(db, rid, d.partyId)) {
        if (r.open.gt(0) && r.dueDate) receivable.push({ id: r.id, kind: r.kind === 'SALE' ? 'SALE' : 'OPENING', customerId: d.partyId, dueDate: r.dueDate, openIqd: r.open.times(r.lockedRate) });
      }
    }
    const byDate = new Map(week.map((w) => [w.date, w.iqd]));
    const trailing = Array.from({ length: SALES_DROP_TRAILING_DAYS }, (_, i) => byDate.get(addDays(today, -(SALES_DROP_TRAILING_DAYS - i))) ?? new D(0));
    const alerts = computeAlerts({
      today,
      receivables: receivable,
      sales: { today: byDate.get(today) ?? new D(0), trailing },
      prices: lines.map((l) => ({
        saleId: l.saleId,
        saleLineId: l.id,
        itemId: l.itemId,
        date: l.sale.date.toISOString().slice(0, 10),
        currency: l.sale.currency,
        officialPrice: new D(l.officialPrice.toString()),
        finalPrice: new D(l.finalPrice.toString()),
      })),
    });
    const shown = alerts.slice(0, 12);
    const customerIds = [...new Set(shown.map((a) => a.refs.customerId).filter((x): x is string => !!x))];
    const itemIds = [...new Set(shown.map((a) => a.refs.itemId).filter((x): x is string => !!x))];
    const [customers, items] = await Promise.all([
      db.whCustomer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }),
      db.whItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, names: true } }),
    ]);
    const cname = new Map(customers.map((c) => [c.id, c.name]));
    const iname = new Map(items.map((i) => [i.id, i.names as unknown]));
    return plain({
      total: alerts.length,
      alerts: shown.map((a) => ({
        kind: a.kind,
        severity: a.severity,
        params: a.params,
        customer: a.refs.customerId ? (cname.get(a.refs.customerId) ?? '') : '',
        customerId: a.refs.customerId ?? '',
        saleId: a.refs.saleId ?? '',
        itemNames: a.refs.itemId ? (iname.get(a.refs.itemId) ?? null) : null,
      })),
    });
  },
});

/**
 * How long each item's stock lasts at its recent selling speed (plain arithmetic, no AI): the last N days of posted sales (N from the
 * settings), stock on hand in the main and rep warehouses (never the damaged one), and the last day to order given the supplier lead
 * days. Items with stock or sales, slowest cover first; items with no sales have no cover.
 */
export const forecastQuery = defineQuery({
  name: 'wh.report.forecast',
  permission: null,
  wh: 'report.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { db } = scoped(ctx);
    const today = baghdadDate();
    const settings = await getSettings(db);
    const window = settings.forecastWindowDays;
    const from = addDays(today, -(window - 1));
    const [balances, lines] = await Promise.all([
      db.whStockBalance.findMany({ where: { qtyBase: { not: 0 }, warehouse: { kind: { not: 'DAMAGE' } } }, select: { itemId: true, qtyBase: true } }),
      db.whSaleLine.findMany({ where: { sale: { status: 'POSTED', date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } } }, select: { itemId: true, qtyBase: true }, take: 100000 }),
    ]);
    const onHand = new Map<string, InstanceType<typeof D>>();
    for (const b of balances) onHand.set(b.itemId, (onHand.get(b.itemId) ?? new D(0)).plus(b.qtyBase.toString()));
    const sold = new Map<string, InstanceType<typeof D>>();
    for (const l of lines) sold.set(l.itemId, (sold.get(l.itemId) ?? new D(0)).plus(l.qtyBase.toString()));
    const ids = [...new Set([...onHand.keys(), ...sold.keys()])];
    const items = await db.whItem.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, code: true, names: true, baseUnit: true } });
    const active = activeDaysOf(today, null, window);
    const rows = items.map((i) => {
      const have = onHand.get(i.id) ?? new D(0);
      const rate = dailyRate(sold.get(i.id) ?? new D(0), new D(0), window, active);
      const cover = daysOfCover(have, rate);
      return { itemId: i.id, code: i.code, names: i.names, baseUnit: i.baseUnit as string, onHand: have, rate, coverDays: cover, reorderBy: reorderBy(today, cover, settings.reorderLeadDays) };
    });
    rows.sort((a, b) => (a.coverDays ?? Number.MAX_SAFE_INTEGER) - (b.coverDays ?? Number.MAX_SAFE_INTEGER) || a.code.localeCompare(b.code));
    return plain({ window, leadDays: settings.reorderLeadDays, rows: rows.slice(0, 300) });
  },
});

/**
 * Every batch that still has stock and an expiry date, soonest first: what is already expired, what expires within the
 * warning days (settings) and the rest. A rep sees only the batches in his own warehouse. Items without an expiry date are
 * not listed (nothing to watch).
 */
export const expiryQuery = defineQuery({
  name: 'wh.expiry',
  permission: null,
  wh: 'stock.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { db, user } = scoped(ctx);
    const today = baghdadDate();
    const settings = await getSettings(db);
    const rows = await db.whBatch.findMany({
      where: { qtyBase: { gt: 0 }, expiry: { not: null }, ...(user.role === 'REP' ? { warehouse: { kind: 'REP' as const, repUserId: user.id } } : {}) },
      orderBy: { expiry: 'asc' },
      take: 500,
      select: { itemId: true, qtyBase: true, expiry: true, warehouse: { select: { name: true, kind: true } }, item: { select: { code: true, names: true, baseUnit: true, active: true } } },
    });
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const list = rows
      .filter((r) => r.item.active)
      .map((r) => {
        const expiry = day(r.expiry!);
        const daysLeft = daysUntil(expiry, today);
        return {
          itemId: r.itemId,
          code: r.item.code,
          names: r.item.names,
          baseUnit: r.item.baseUnit as string,
          warehouse: r.warehouse.kind === 'MAIN' ? null : r.warehouse.name,
          qtyBase: r.qtyBase.toString(),
          expiry,
          daysLeft,
          status: expiryStatus(daysLeft, settings.expiryAlertDays),
        };
      });
    return plain({ alertDays: settings.expiryAlertDays, rows: list });
  },
});

/**
 * What the side menu shows under each section's name: a few live counts. A partner also sees what waits on them (sales to
 * approve, handovers, expenses) and what needs a look in stock; a rep sees only the counts of his own work.
 */
export const navInfoQuery = defineQuery({
  name: 'wh.navInfo',
  permission: null,
  wh: 'catalog.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { db, user } = scoped(ctx);
    const restaurantId = ctx.wh!.restaurantId;
    const partner = canWh(user.role, 'report.view');
    const today = baghdadDate();
    const settings = await getSettings(db);
    const soon = new Date(`${addDays(today, settings.expiryAlertDays)}T00:00:00Z`);
    const [items, customers, staff, sold, expiring] = await Promise.all([
      db.whItem.count({ where: { active: true } }),
      listCustomers(db, restaurantId, { role: user.role, userId: user.id }).then((rows) => rows.length),
      partner ? db.whStaff.count() : Promise.resolve(0),
      salesByDay(db, { from: today, to: today }),
      db.whBatch.count({ where: { qtyBase: { gt: 0 }, expiry: { not: null, lte: soon }, item: { active: true }, ...(user.role === 'REP' ? { warehouse: { kind: 'REP' as const, repUserId: user.id } } : {}) } }),
    ]);
    let pending = { sales: 0, handovers: 0, expenses: 0 };
    if (partner) {
      const [ps, ph, pe] = await Promise.all([listPendingSales(db), listPendingHandovers(db), listExpenses(db, user, 'PENDING')]);
      pending = { sales: ps.length, handovers: ph.length, expenses: pe.length };
    }
    return plain({ items, customers, staff, salesToday: sold[0]?.count ?? 0, expiring, pending });
  },
});

/**
 * The few numbers the sell screen keeps in view: the cash in the till (a partner: the company's cash; a rep: the money he
 * holds), and what is expired or about to expire (a rep: his own warehouse only). Today's sales come from the sales list.
 */
export const sellInfoQuery = defineQuery({
  name: 'wh.sellInfo',
  permission: null,
  wh: 'sale.create',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { db, user } = scoped(ctx);
    const today = baghdadDate();
    const settings = await getSettings(db);
    const rep = user.role === 'REP';
    const [cash, batches] = await Promise.all([
      rep
        ? getCustody(db, ctx.wh!.restaurantId, user, user.id).then((rows) => Object.fromEntries(rows.map((r) => [r.currency, r.balance.toFixed()])))
        : cashPosition(db).then((p) => Object.fromEntries(Object.entries(p.cash).map(([k, v]) => [k, (v as { toFixed(): string }).toFixed()]))),
      db.whBatch.findMany({
        where: { qtyBase: { gt: 0 }, expiry: { not: null }, item: { active: true }, ...(rep ? { warehouse: { kind: 'REP' as const, repUserId: user.id } } : {}) },
        orderBy: { expiry: 'asc' },
        take: 300,
        select: { expiry: true, item: { select: { names: true } } },
      }),
    ]);
    let expired = 0;
    let soon = 0;
    let next: { names: { ckb: string; ar: string; en: string }; days: number } | null = null;
    for (const b of batches) {
      const days = daysUntil(b.expiry!.toISOString().slice(0, 10), today);
      const status = expiryStatus(days, settings.expiryAlertDays);
      if (status === 'expired') expired += 1;
      else if (status === 'soon') {
        soon += 1;
        next ??= { names: b.item.names as { ckb: string; ar: string; en: string }, days };
      }
    }
    return plain({ cash, expired, soon, next });
  },
});

/** Every sale and every purchase in a date range, one row per line, for the spreadsheet export. Partners only. */
export const movementsExportQuery = defineQuery({
  name: 'wh.report.movements',
  permission: null,
  wh: 'report.view',
  input: whPlaceInput.extend({ from: isoDate, to: isoDate }),
  target: whTargetOf,
  run: async (ctx, { from, to }) => {
    const { db } = scoped(ctx);
    const range = { gte: toDate(from), lte: toDate(to) };
    const [sales, purchases] = await Promise.all([
      db.whSale.findMany({
        where: { date: range },
        orderBy: { number: 'asc' },
        take: 20000,
        select: {
          number: true, date: true, currency: true, paymentMode: true, status: true, totalFinal: true,
          customer: { select: { name: true, ownerName: true, phone: true, address: true, city: { select: { name: true } } } },
          lines: { orderBy: { lineNo: 'asc' }, select: { qty: true, unit: true, finalPrice: true, lineTotal: true, item: { select: { code: true, names: true } } } },
        },
      }),
      db.whPurchase.findMany({
        where: { date: range },
        orderBy: { number: 'asc' },
        take: 20000,
        select: {
          number: true, date: true, currency: true, paymentMode: true, status: true, totalOriginal: true,
          supplier: { select: { name: true } },
          lines: { orderBy: { lineNo: 'asc' }, select: { qty: true, unit: true, unitPrice: true, lineTotal: true, item: { select: { code: true, names: true } } } },
        },
      }),
    ]);
    return plain({ sales, purchases });
  },
});

/**
 * Each rep's account in one read: the cash he holds (custody: what he owes the company until he hands it over), what the
 * shops of his route owe, and what he collected (this month and the latest receipts). A partner sees every rep, a rep only himself.
 */
export const repAccountsQuery = defineQuery({
  name: 'wh.reps.accounts',
  permission: null,
  wh: 'sale.create',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { db, user } = scoped(ctx);
    const rid = ctx.wh!.restaurantId;
    const manage = canWh(user.role, 'custody.confirm');
    const monthStart = `${baghdadDate().slice(0, 7)}-01`;
    const reps = await db.whStaff.findMany({
      where: { restaurantId: rid, role: 'REP', deactivatedAt: null, ...(manage ? {} : { userId: user.id }) },
      select: { userId: true, user: { select: { name: true } } },
    });
    const customers = await listCustomers(db, rid, { role: user.role, userId: user.id });
    const addTo = (totals: Record<string, number>, currency: string, amount: number) => {
      totals[currency] = (totals[currency] ?? 0) + amount;
    };
    const out = [];
    for (const rep of reps) {
      const mine = customers.filter((c) => c.repId === rep.userId);
      const debtors = [];
      const owed: Record<string, number> = {};
      for (const c of mine) {
        const open = (await receivables(db, rid, c.id)).filter((d) => d.open.gt(0));
        if (open.length === 0) continue;
        const totals: Record<string, number> = {};
        for (const d of open) {
          addTo(totals, d.currency as string, Number(d.open.toFixed()));
          addTo(owed, d.currency as string, Number(d.open.toFixed()));
        }
        debtors.push({ id: c.id, name: c.name, totals });
      }
      const payments = await db.whCustomerPayment.findMany({
        where: { restaurantId: rid, userId: rep.userId, receivedByRep: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 200,
        select: { id: true, amount: true, currency: true, date: true, customer: { select: { name: true } } },
      });
      const collected: Record<string, number> = {};
      for (const p of payments) if (String(p.date.toISOString()).slice(0, 10) >= monthStart) addTo(collected, p.currency as string, Number(p.amount.toFixed()));
      const custody = await getCustody(db, rid, user, rep.userId);
      out.push({
        userId: rep.userId,
        name: rep.user.name,
        custody: custody.map((c) => ({ currency: c.currency as string, balance: c.balance.toFixed(), reserved: c.reserved.toFixed() })),
        owed: Object.fromEntries(Object.entries(owed).map(([k, v]) => [k, String(v)])),
        debtors: debtors.sort((a, b) => Object.values(b.totals).reduce((s, v) => s + v, 0) - Object.values(a.totals).reduce((s, v) => s + v, 0)).map((d) => ({ ...d, totals: Object.fromEntries(Object.entries(d.totals).map(([k, v]) => [k, String(v)])) })),
        collected: Object.fromEntries(Object.entries(collected).map(([k, v]) => [k, String(v)])),
        recent: payments.slice(0, 8).map((p) => ({ id: p.id, customer: p.customer.name, amount: p.amount.toFixed(), currency: p.currency as string, date: p.date.toISOString().slice(0, 10) })),
      });
    }
    return plain(out);
  },
});
