import { D } from '@/server/domain/wholesale/money';
import type { Currency } from '@/server/domain/wholesale/rates';
import type { ScopedTx } from '@/server/data/tenant-db';

/**
 * Reads of the books for the reports and the home screen (Phase 6). Everything comes from the journal, so a report
 * can never disagree with the ledger. Money stays Decimal here; the queries turn it into text.
 *
 * Native balances (cash boxes, receivables, payables) are kept per currency. Profit is in IQD, from the lines'
 * `baseIqd`, as every entry balances on it.
 */

type Db = ScopedTx;
type DD = InstanceType<typeof D>;
export type ByCurrency = Partial<Record<Currency, DD>>;
export type Range = { from?: string; to?: string };

const dateFilter = ({ from, to }: Range) => (from || to ? { entry: { date: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}) } } } : {});

type Totals = { code: string; type: string; normalSide: 'DR' | 'CR'; currency: Currency; dr: DD; cr: DD; drIqd: DD; crIqd: DD };

/** Debit and credit totals per account and currency over a date range. */
export async function accountTotals(db: Db, range: Range = {}, partyId?: string): Promise<Totals[]> {
  const groups = await db.whJournalLine.groupBy({
    by: ['accountId', 'currency', 'side'],
    where: { ...dateFilter(range), ...(partyId ? { partyId } : {}) },
    _sum: { amount: true, baseIqd: true },
  });
  const accounts = await db.whLedgerAccount.findMany({ select: { id: true, code: true, type: true, normalSide: true } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = new Map<string, Totals>();
  for (const g of groups) {
    const a = byId.get(g.accountId);
    if (!a) continue;
    const key = `${a.code}|${g.currency}`;
    const row = out.get(key) ?? { code: a.code, type: a.type, normalSide: a.normalSide, currency: g.currency as Currency, dr: new D(0), cr: new D(0), drIqd: new D(0), crIqd: new D(0) };
    const amount = new D((g._sum.amount ?? 0).toString());
    const iqd = new D((g._sum.baseIqd ?? 0).toString());
    if (g.side === 'DR') {
      row.dr = row.dr.plus(amount);
      row.drIqd = row.drIqd.plus(iqd);
    } else {
      row.cr = row.cr.plus(amount);
      row.crIqd = row.crIqd.plus(iqd);
    }
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code) || a.currency.localeCompare(b.currency));
}

/** Balance in the account's natural direction (positive = normal side). */
const natural = (t: Totals, iqd: boolean): DD => {
  const dr = iqd ? t.drIqd : t.dr;
  const cr = iqd ? t.crIqd : t.cr;
  return t.normalSide === 'DR' ? dr.minus(cr) : cr.minus(dr);
};

function sumByCurrency(rows: Totals[], codes: string[]): ByCurrency {
  const out: ByCurrency = {};
  for (const t of rows) if (codes.includes(t.code)) out[t.currency] = (out[t.currency] ?? new D(0)).plus(natural(t, false));
  return out;
}

/** What each cash box holds, per currency, and what is still with the reps and not yet handed in. */
export async function cashPosition(db: Db): Promise<{ cash: ByCurrency; repCustody: ByCurrency }> {
  const rows = await accountTotals(db);
  return { cash: sumByCurrency(rows, ['CASH_IQD', 'CASH_USD', 'CASH_IRT']), repCustody: sumByCurrency(rows, ['REP_CUSTODY']) };
}

/** What customers owe and what the company owes suppliers, per currency. */
export async function debts(db: Db): Promise<{ receivable: ByCurrency; payable: ByCurrency }> {
  const rows = await accountTotals(db);
  return { receivable: sumByCurrency(rows, ['AR']), payable: sumByCurrency(rows, ['AP']) };
}

export type ProfitReport = {
  salesIqd: DD;
  discountsIqd: DD;
  cogsIqd: DD;
  grossIqd: DD;
  fxIqd: DD;
  expensesIqd: DD;
  netIqd: DD;
  expenseLines: { code: string; iqd: DD }[];
};

/** Profit and loss for a date range, in IQD. */
export async function profit(db: Db, range: Range): Promise<ProfitReport> {
  const rows = await accountTotals(db, range);
  const iqd = (code: string): DD => rows.filter((r) => r.code === code).reduce((s, r) => s.plus(natural(r, true)), new D(0));
  const salesIqd = iqd('SALES');
  const discountsIqd = iqd('SALES_DISCOUNT');
  const cogsIqd = iqd('COGS');
  const grossIqd = salesIqd.minus(discountsIqd).minus(cogsIqd);
  const fxIqd = iqd('FX_GAIN').minus(iqd('FX_LOSS'));
  const expenseCodes = [...new Set(rows.filter((r) => r.type === 'EXPENSE' && !['COGS', 'FX_LOSS'].includes(r.code)).map((r) => r.code))];
  const expenseLines = expenseCodes.map((code) => ({ code, iqd: iqd(code) })).filter((l) => !l.iqd.isZero());
  const expensesIqd = expenseLines.reduce((s, l) => s.plus(l.iqd), new D(0));
  return { salesIqd, discountsIqd, cogsIqd, grossIqd, fxIqd, expensesIqd, netIqd: grossIqd.plus(fxIqd).minus(expensesIqd), expenseLines };
}

export type StockValueRow = { itemId: string; code: string; names: unknown; warehouseId: string; warehouse: string; qtyBase: DD; valueIqd: DD; reorderPoint: DD | null };

/** On-hand quantity and value (at weighted-average cost) per item and warehouse; empty rows are left out. */
export async function stockValue(db: Db, warehouseId?: string): Promise<{ rows: StockValueRow[]; totalIqd: DD }> {
  const balances = await db.whStockBalance.findMany({
    where: { ...(warehouseId ? { warehouseId } : {}), qtyBase: { not: 0 } },
    select: { itemId: true, warehouseId: true, qtyBase: true, avgCostIqd: true, item: { select: { code: true, names: true, reorderPoint: true } }, warehouse: { select: { name: true } } },
  });
  const rows = balances.map((b) => {
    const qty = new D(b.qtyBase.toString());
    return { itemId: b.itemId, code: b.item.code, names: b.item.names, warehouseId: b.warehouseId, warehouse: b.warehouse.name, qtyBase: qty, valueIqd: qty.times(b.avgCostIqd.toString()), reorderPoint: b.item.reorderPoint ? new D(b.item.reorderPoint.toString()) : null };
  });
  rows.sort((a, b) => b.valueIqd.comparedTo(a.valueIqd));
  return { rows, totalIqd: rows.reduce((s, r) => s.plus(r.valueIqd), new D(0)) };
}

/** Items whose total on hand (all warehouses) is at or under their reorder point. */
export function lowStock(rows: StockValueRow[]): { itemId: string; code: string; names: unknown; qtyBase: DD; reorderPoint: DD }[] {
  const by = new Map<string, { itemId: string; code: string; names: unknown; qtyBase: DD; reorderPoint: DD | null }>();
  for (const r of rows) {
    const cur = by.get(r.itemId) ?? { itemId: r.itemId, code: r.code, names: r.names, qtyBase: new D(0), reorderPoint: r.reorderPoint };
    cur.qtyBase = cur.qtyBase.plus(r.qtyBase);
    by.set(r.itemId, cur);
  }
  return [...by.values()].filter((x): x is typeof x & { reorderPoint: DD } => x.reorderPoint !== null && x.qtyBase.lte(x.reorderPoint));
}

/** Posted sales per day over a range, in IQD (the final price of the sale at its locked rate is not stored, so this reads the ledger). */
export async function salesByDay(db: Db, range: Range): Promise<{ date: string; iqd: DD; count: number }[]> {
  const sales = await db.whSale.findMany({
    where: { status: 'POSTED', ...(range.from || range.to ? { date: { ...(range.from ? { gte: new Date(`${range.from}T00:00:00Z`) } : {}), ...(range.to ? { lte: new Date(`${range.to}T00:00:00Z`) } : {}) } } : {}) },
    select: { date: true, journalEntryId: true },
  });
  const entryIds = sales.map((s) => s.journalEntryId).filter((x): x is string => !!x);
  const lines = entryIds.length ? await db.whJournalLine.findMany({ where: { entryId: { in: entryIds }, account: { code: 'SALES' } }, select: { entryId: true, baseIqd: true } }) : [];
  const sold = new Map(lines.map((l) => [l.entryId, new D(l.baseIqd.toString())]));
  const out = new Map<string, { date: string; iqd: DD; count: number }>();
  for (const s of sales) {
    const date = s.date.toISOString().slice(0, 10);
    const row = out.get(date) ?? { date, iqd: new D(0), count: 0 };
    row.iqd = row.iqd.plus(s.journalEntryId ? (sold.get(s.journalEntryId) ?? 0) : 0);
    row.count += 1;
    out.set(date, row);
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type PartyBalance = { partyId: string; name: string; balances: ByCurrency };

/** Who owes the company (`AR`) or whom it owes (`AP`), per party and currency; settled parties are left out. */
export async function partyBalances(db: Db, code: 'AR' | 'AP'): Promise<PartyBalance[]> {
  const account = await db.whLedgerAccount.findFirst({ where: { code }, select: { id: true, normalSide: true } });
  if (!account) return [];
  const groups = await db.whJournalLine.groupBy({ by: ['partyId', 'currency', 'side'], where: { accountId: account.id, partyId: { not: null } }, _sum: { amount: true } });
  const by = new Map<string, ByCurrency>();
  for (const g of groups) {
    if (!g.partyId) continue;
    const sign = g.side === account.normalSide ? 1 : -1;
    const bal = by.get(g.partyId) ?? {};
    const cur = g.currency as Currency;
    bal[cur] = (bal[cur] ?? new D(0)).plus(new D((g._sum.amount ?? 0).toString()).times(sign));
    by.set(g.partyId, bal);
  }
  const ids = [...by.keys()];
  const names = new Map<string, string>();
  const table = code === 'AR' ? db.whCustomer : db.whSupplier;
  for (const p of await (table as typeof db.whCustomer).findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names.set(p.id, p.name);
  return ids
    .map((partyId) => ({ partyId, name: names.get(partyId) ?? partyId, balances: Object.fromEntries(Object.entries(by.get(partyId)!).filter(([, v]) => !v.isZero())) as ByCurrency }))
    .filter((p) => Object.keys(p.balances).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
