import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type { ScopedTx } from '@/server/data/tenant-db';
import { InvalidStockError, QTY_DP, assertCost } from '@/server/domain/wholesale/costing';
import type { LineInput } from '@/server/domain/wholesale/ledger';
import { D } from '@/server/domain/wholesale/money';
import { ForbiddenError, canWh, type WhRole } from '@/server/domain/wholesale/permissions';
import { round4 } from '@/server/domain/wholesale/purchase';
import { baghdadDate, isIsoDate } from '@/server/domain/wholesale/rates';
import { postJournal } from '@/server/wholesale/ledger';
import { assertPeriodOpen } from '@/server/wholesale/period';
import { issueStock, lockStockRows, receiveStock, stockKey } from '@/server/wholesale/stock';

/*
 * Stock count (stock.count: OWNER and PARTNER, for the main warehouse or any rep warehouse). One transaction, dated today
 * (Asia/Baghdad), month open:
 * - every counted item's balance row is locked first, so the book quantity read is the one the adjustment applies to;
 * - counted < book: the shortage is issued at the weighted average and posted DR STOCK_ADJUSTMENT / CR INVENTORY;
 * - counted > book: the surplus is received at `unitCostIqd` when given, else at the current average when something is on hand;
 *   with nothing on hand and no cost the count is refused (a gain needs a cost). Posted DR INVENTORY / CR STOCK_ADJUSTMENT;
 * - counted = book: nothing moves, the line is still recorded;
 * - the damage warehouse is never counted (its stock is already written off).
 * Each count is one WhStockCount with a WhStockCountLine per item. Append-only. Nothing is written when it throws.
 */

type Db = ScopedTx;
type DD = InstanceType<typeof D>;
type Dec = Decimal | string;
type WhUser = { id: string; role: WhRole };

export type StockCountLineInput = {
  itemId: string;
  /** The counted quantity in base units, >= 0. */
  countedBase: Dec;
  /** IQD per base unit for a surplus; default the current average (required when nothing is on hand). */
  unitCostIqd?: Dec | null;
  /** Expiry of a surplus batch ('YYYY-MM-DD'); default none. */
  expiry?: string | null;
};
export type StockCountInput = { warehouseId: string; counts: StockCountLineInput[] };

const MAX_LINES = 2000;
const QTY_MAX = new D(10).pow(24 - QTY_DP);
const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`);
const sum = (xs: DD[]): DD => xs.reduce((a, b) => a.plus(b), new D(0));

function parseCounted(v: unknown, at: string): DD {
  if (typeof v !== 'string' && !Decimal.isDecimal(v)) throw new InvalidStockError(`${at}: counted quantity must be a string or Decimal`);
  let d: DD;
  try {
    d = new D(typeof v === 'string' ? v.trim() : v.toString());
  } catch {
    throw new InvalidStockError(`${at}: counted quantity is not a number`);
  }
  if (!d.isFinite()) throw new InvalidStockError(`${at}: counted quantity must be finite`);
  if (d.isNegative() && !d.isZero()) throw new InvalidStockError(`${at}: counted quantity cannot be negative`);
  if (d.decimalPlaces() > QTY_DP) throw new InvalidStockError(`${at}: counted quantity has more than ${QTY_DP} decimal places`);
  if (d.gte(QTY_MAX)) throw new InvalidStockError(`${at}: counted quantity is too large`);
  return d.isZero() ? new D(0) : d;
}

function cleanInput(input: StockCountInput) {
  if (!input || typeof input !== 'object') throw new InvalidStockError('count is required');
  if (typeof input.warehouseId !== 'string' || !input.warehouseId) throw new InvalidStockError('warehouse is required');
  if (!Array.isArray(input.counts) || input.counts.length === 0) throw new InvalidStockError('a count needs at least one item');
  if (input.counts.length > MAX_LINES) throw new InvalidStockError(`a count has at most ${MAX_LINES} items`);
  const seen = new Set<string>();
  const counts = input.counts.map((c, i) => {
    const at = `count line ${i + 1}`;
    if (!c || typeof c !== 'object') throw new InvalidStockError(`${at}: not a line`);
    if (typeof c.itemId !== 'string' || !c.itemId) throw new InvalidStockError(`${at}: item is required`);
    if (seen.has(c.itemId)) throw new InvalidStockError(`${at}: the item is counted twice`);
    seen.add(c.itemId);
    const counted = parseCounted(c.countedBase, at);
    const cost = c.unitCostIqd === undefined || c.unitCostIqd === null || c.unitCostIqd === '' ? null : assertCost(c.unitCostIqd, `${at}: unit cost`);
    const expiry = c.expiry === undefined || c.expiry === null || c.expiry === '' ? null : c.expiry;
    if (expiry !== null && !isIsoDate(expiry)) throw new InvalidStockError(`${at}: expiry must be a date (YYYY-MM-DD)`);
    return { at, itemId: c.itemId, counted, cost, expiry };
  });
  return { warehouseId: input.warehouseId, counts };
}

/** Post a stock count of one warehouse inside the caller's transaction (see the header). */
export async function postStockCountTx(tx: Db, rid: string, user: WhUser, input: StockCountInput): Promise<{ countId: string; entryId: string | null; differences: number }> {
  if (!canWh(user.role, 'stock.count')) throw new ForbiddenError('stock.count');
  const inp = cleanInput(input);
  const w = await tx.whWarehouse.findUnique({ where: { id: inp.warehouseId }, select: { id: true, kind: true, name: true } });
  if (!w) throw new InvalidStockError('unknown warehouse');
  if (w.kind === 'DAMAGE') throw new InvalidStockError('the damage warehouse is not counted: its stock is already written off');
  const date = baghdadDate();
  await assertPeriodOpen(tx, rid, date);

  const book = await lockStockRows(tx, rid, inp.counts.map((c) => ({ itemId: c.itemId, warehouseId: w.id })));
  const countId = randomUUID();
  const ref = { type: 'STOCK_COUNT', id: countId };
  const lines: { itemId: string; book: DD; counted: DD; diff: DD; cost: DD; value: DD; expiry: string | null; exact: DD }[] = [];
  for (const c of inp.counts) {
    const b = book.get(stockKey(c.itemId, w.id))!;
    const bookQty = new D(b.qtyBase);
    const diff = c.counted.minus(bookQty);
    if (diff.isZero()) {
      lines.push({ itemId: c.itemId, book: bookQty, counted: c.counted, diff, cost: new D(0), value: new D(0), expiry: null, exact: new D(0) });
      continue;
    }
    let cost: DD;
    if (diff.lt(0)) {
      cost = new D((await issueStock(tx, { restaurantId: rid, itemId: c.itemId, warehouseId: w.id, qtyBase: diff.abs(), ref, user })).unitCostIqd);
    } else {
      const at = c.cost ?? (bookQty.gt(0) ? new D(b.avgCostIqd) : null);
      if (at === null) throw new InvalidStockError(`${c.at}: nothing is on hand to take a cost from: enter the unit cost of the surplus`);
      cost = new D((await receiveStock(tx, { restaurantId: rid, itemId: c.itemId, warehouseId: w.id, qtyBase: diff, unitCostIqd: at, expiry: c.expiry, ref, user })).unitCostIqd);
    }
    const exact = diff.abs().times(cost);
    lines.push({ itemId: c.itemId, book: bookQty, counted: c.counted, diff, cost, value: round4(exact), expiry: diff.gt(0) ? c.expiry : null, exact });
  }
  const lossIqd = round4(sum(lines.filter((l) => l.diff.lt(0)).map((l) => l.exact)));
  const gainIqd = round4(sum(lines.filter((l) => l.diff.gt(0)).map((l) => l.exact)));

  let entryId: string | null = null;
  if (lossIqd.gt(0) || gainIqd.gt(0)) {
    const journal: LineInput[] = [];
    if (lossIqd.gt(0)) {
      journal.push({ accountCode: 'STOCK_ADJUSTMENT', side: 'DR', amount: lossIqd, currency: 'IQD' });
      journal.push({ accountCode: 'INVENTORY', side: 'CR', amount: lossIqd, currency: 'IQD' });
    }
    if (gainIqd.gt(0)) {
      journal.push({ accountCode: 'INVENTORY', side: 'DR', amount: gainIqd, currency: 'IQD' });
      journal.push({ accountCode: 'STOCK_ADJUSTMENT', side: 'CR', amount: gainIqd, currency: 'IQD' });
    }
    entryId = (await postJournal(tx, rid, { date, memo: `Stock count of ${w.name}`, source: ref, user, lines: journal })).entryId;
  }

  await tx.whStockCount.create({
    data: { id: countId, restaurantId: rid, warehouseId: w.id, date: toDbDate(date), lossIqd: lossIqd.toFixed(), gainIqd: gainIqd.toFixed(), journalEntryId: entryId, userId: user.id },
  });
  await tx.whStockCountLine.createMany({
    data: lines.map((l, i) => ({
      restaurantId: rid,
      countId,
      lineNo: i + 1,
      itemId: l.itemId,
      bookQtyBase: l.book.toFixed(),
      countedBase: l.counted.toFixed(),
      diffBase: l.diff.toFixed(),
      unitCostIqd: l.cost.toFixed(),
      valueIqd: l.value.toFixed(),
      expiry: l.expiry ? toDbDate(l.expiry) : null,
    })),
  });
  return { countId, entryId, differences: lines.filter((l) => !l.diff.isZero()).length };
}

/** Past counts for the screen, newest first. */
export async function listStockCounts(tx: Db) {
  const rows = await tx.whStockCount.findMany({ orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, number: true, date: true, lossIqd: true, gainIqd: true, warehouse: { select: { name: true, kind: true } }, _count: { select: { lines: true } } } });
  return rows.map((r) => ({ id: r.id, number: r.number.toString(), date: r.date.toISOString().slice(0, 10), lossIqd: r.lossIqd.toString(), gainIqd: r.gainIqd.toString(), warehouse: r.warehouse.kind === 'MAIN' ? '' : r.warehouse.name, main: r.warehouse.kind === 'MAIN', lines: r._count.lines }));
}
