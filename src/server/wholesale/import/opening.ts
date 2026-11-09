import { randomUUID } from 'node:crypto';
import type { ScopedTx } from '@/server/data/tenant-db';
import { QTY_DP, roundCost } from '@/server/domain/wholesale/costing';
import { normalizeNumber, parseCsv, type CsvError, type CsvRecord } from '@/server/domain/wholesale/csv';
import { AMOUNT_MAX, type LineInput } from '@/server/domain/wholesale/ledger';
import { D } from '@/server/domain/wholesale/money';
import { ForbiddenError, canWh, type WhRole } from '@/server/domain/wholesale/permissions';
import { round4 } from '@/server/domain/wholesale/purchase';
import { CURRENCIES, baghdadDate, isIsoDate, type Currency } from '@/server/domain/wholesale/rates';
import { lockOpening, postJournal } from '@/server/wholesale/ledger';
import { lockStockRows, receiveStock } from '@/server/wholesale/stock';
import { warehouseOfKind } from '@/server/wholesale/warehouses';

/*
 * Opening balances: the starting position of a company that already trades (stock, what customers owe, what is owed to suppliers,
 * the cash boxes). One kind per import, all or nothing in ONE transaction: every row is checked before the first write and EVERY
 * problem is reported ({ row, message }, row = the 1-based data row, 0 = the header or the whole file); with any problem `imported`
 * is 0 and the caller's transaction must be rolled back (`importOpeningTx` returns the errors and writes nothing before them).
 *
 * Input is CSV text (header row required, names case-insensitive, any order). The screens build it from simple forms, so nobody
 * has to write a CSV by hand, but a file works too. Numbers may use Latin, Arabic-Indic or Persian digits and '.' (or U+066B).
 * `currency` is IQD, USD or IRT; `rate` = IQD per 1 unit of it, required for USD and IRT (the opening values are pinned at it, no
 * exchange-rate row is needed), empty or 1 for IQD.
 * - STOCK:     item (item code), qty (base units, > 0), unit_cost (per base unit, >= 0), currency, [rate],
 *              [warehouse] (empty or MAIN = the main warehouse, else the exact name of a rep warehouse), [expiry] (YYYY-MM-DD).
 *              Received through the stock engine, DR INVENTORY / CR PARTNER_CAPITAL.
 * - CUSTOMERS: customer (id or exact unique name), currency, amount (> 0), [rate]. DR AR / CR PARTNER_CAPITAL; each row is an
 *              OpeningDebt that payments settle oldest-first.
 * - SUPPLIERS: supplier (id or exact unique name), currency, amount (> 0), [rate]. DR PARTNER_CAPITAL / CR AP.
 * - CASH:      currency, amount (> 0), [rate]. DR CASH_<currency> / CR PARTNER_CAPITAL. One row per currency.
 *
 * Rulings: STOCK is imported once (later corrections are stock counts); CUSTOMERS, SUPPLIERS and CASH may be imported again for what
 * was forgotten, but each (party, currency) and each cash currency is opened once. One opening date for every kind: the first import
 * fixes it (`opts.date`, else the day before the earliest posted entry, else yesterday); later imports use it. From then on
 * postJournal refuses an entry dated before it.
 */

type Db = ScopedTx;
type DD = InstanceType<typeof D>;
type WhUser = { id: string; role: WhRole };

export const OPENING_KINDS = ['STOCK', 'CUSTOMERS', 'SUPPLIERS', 'CASH'] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];

export const OPENING_COLUMNS: Record<OpeningKind, { required: string[]; optional: string[] }> = {
  STOCK: { required: ['item', 'qty', 'unit_cost', 'currency'], optional: ['rate', 'warehouse', 'expiry'] },
  CUSTOMERS: { required: ['customer', 'currency', 'amount'], optional: ['rate'] },
  SUPPLIERS: { required: ['supplier', 'currency', 'amount'], optional: ['rate'] },
  CASH: { required: ['currency', 'amount'], optional: ['rate'] },
};

export const MAX_OPENING_ROWS = 5000;

export type OpeningResult = { imported: number; errors: CsvError[]; importId?: string; totalIqd?: string };

/** The import cannot run at all: unknown kind, the kind was already imported, or a bad opening date. Nothing written. */
export class OpeningImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpeningImportError';
  }
}

const QTY_MAX = new D(10).pow(24 - QTY_DP);
const RATE_MAX = new D('1e10');
const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`);
const isoOf = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number): string => isoOf(new Date(toDbDate(date).getTime() + days * 86_400_000));
const sum = (xs: DD[]): DD => xs.reduce((a, b) => a.plus(b), new D(0));

/** The opening date, checked against what is already posted. The caller holds the opening lock. */
async function openingDate(tx: Db, requested: string | undefined): Promise<string> {
  if (requested !== undefined && !isIsoDate(requested)) throw new OpeningImportError('the opening date must be a date (YYYY-MM-DD)');
  const existing = await tx.whOpeningImport.findFirst({ select: { date: true } });
  if (existing) {
    const date = isoOf(existing.date);
    if (requested !== undefined && requested !== date) throw new OpeningImportError(`the opening date is already ${date}`);
    return date;
  }
  const first = await tx.whJournalEntry.findFirst({ orderBy: { date: 'asc' }, select: { date: true } });
  if (requested !== undefined) {
    if (first && requested >= isoOf(first.date)) throw new OpeningImportError(`the opening date must be before the first posting (${isoOf(first.date)})`);
    return requested;
  }
  return addDays(first ? isoOf(first.date) : baghdadDate(), -1);
}

/** One data row as {column -> cell}, plus a per-row error collector. */
type Row = { row: number; get: (col: string) => string; fail: (message: string) => void; failed: () => boolean };

function rowsOf(records: CsvRecord[], header: string[], errors: CsvError[]): Row[] {
  return records.map((r) => {
    let bad = false;
    const fail = (message: string) => {
      bad = true;
      errors.push({ row: r.row, message });
    };
    if (r.cells.length !== header.length) fail(`has ${r.cells.length} columns, the header has ${header.length}`);
    return { row: r.row, get: (col) => r.cells[header.indexOf(col)] ?? '', fail, failed: () => bad };
  });
}

/** A plain non-negative number (no sign, exponent or grouping) with at most `dp` decimals, or null after fail(). */
function num(r: Row, col: string, o: { dp: number; positive: boolean; max: DD }): DD | null {
  const raw = normalizeNumber(r.get(col));
  if (raw === '') {
    r.fail(`${col} is required`);
    return null;
  }
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    r.fail(`${col} is not a number: ${r.get(col)}`);
    return null;
  }
  const v = new D(raw);
  if (o.positive && !v.gt(0)) {
    r.fail(`${col} must be greater than zero`);
    return null;
  }
  if (v.decimalPlaces() > o.dp) {
    r.fail(`${col} has more than ${o.dp} decimal places`);
    return null;
  }
  if (v.gte(o.max)) {
    r.fail(`${col} is too large`);
    return null;
  }
  return v.isZero() ? new D(0) : v;
}

/** currency + rate (IQD per unit; 1 for IQD), or null after fail(). */
function money(r: Row): { currency: Currency; rate: DD } | null {
  const c = r.get('currency').toUpperCase();
  if (!(CURRENCIES as readonly string[]).includes(c)) {
    r.fail(`unknown currency: ${r.get('currency') || '(empty)'}`);
    return null;
  }
  const currency = c as Currency;
  const rawRate = normalizeNumber(r.get('rate'));
  if (currency === 'IQD') {
    if (rawRate !== '' && !(/^\d+(\.\d+)?$/.test(rawRate) && new D(rawRate).eq(1))) {
      r.fail('rate must be empty or 1 for IQD');
      return null;
    }
    return { currency, rate: new D(1) };
  }
  if (rawRate === '') {
    r.fail(`rate is required for ${currency} (IQD per 1 ${currency})`);
    return null;
  }
  const rate = num(r, 'rate', { dp: 8, positive: true, max: RATE_MAX });
  return rate ? { currency, rate } : null;
}

function checkHeader(kind: OpeningKind, header: string[], errors: CsvError[]): void {
  const { required, optional } = OPENING_COLUMNS[kind];
  const known = new Set([...required, ...optional]);
  const seen = new Set<string>();
  for (const h of header) {
    if (!h) errors.push({ row: 0, message: 'a column has no name' });
    else if (!known.has(h)) errors.push({ row: 0, message: `unknown column: ${h}` });
    else if (seen.has(h)) errors.push({ row: 0, message: `duplicate column: ${h}` });
    seen.add(h);
  }
  for (const c of required) if (!seen.has(c)) errors.push({ row: 0, message: `missing column: ${c}` });
}

/** Party lookup by id, else by exact (trimmed) name, which must match exactly one. */
function partyMatcher(parties: { id: string; name: string }[]) {
  const byId = new Map(parties.map((p) => [p.id, p]));
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const p of parties) byName.set(p.name.trim(), [...(byName.get(p.name.trim()) ?? []), p]);
  return (key: string): { id: string } | 'unknown' | 'ambiguous' => {
    const hit = byId.get(key);
    if (hit) return hit;
    const named = byName.get(key) ?? [];
    if (named.length === 1) return named[0]!;
    return named.length ? 'ambiguous' : 'unknown';
  };
}

type StockLine = { row: number; itemId: string; warehouseId: string; qty: DD; costIqd: DD; expiry: string | null };
type DebtLine = { row: number; partyId: string; currency: Currency; amount: DD; rate: DD; baseIqd: DD };

async function checkStock(tx: Db, rid: string, rows: Row[]): Promise<StockLine[]> {
  const codes = [...new Set(rows.map((r) => r.get('item')).filter(Boolean))];
  const items = await tx.whItem.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, active: true } });
  const itemByCode = new Map(items.map((i) => [i.code, i]));
  const main = await warehouseOfKind(tx, rid, 'MAIN');
  const reps = await tx.whWarehouse.findMany({ where: { kind: 'REP' }, select: { id: true, name: true } });
  const seen = new Map<string, number>();
  const out: StockLine[] = [];
  for (const r of rows) {
    const code = r.get('item');
    const item = code ? itemByCode.get(code) : undefined;
    if (!code) r.fail('item is required');
    else if (!item) r.fail(`unknown item code: ${code}`);
    else if (!item.active) r.fail(`item is archived: ${code}`);
    const wName = r.get('warehouse');
    let warehouseId: string | null = null;
    if (wName === '' || wName.toUpperCase() === 'MAIN') warehouseId = main.id;
    else if (wName.toUpperCase() === 'DAMAGE') r.fail('opening stock cannot go into the damage warehouse');
    else {
      const hits = reps.filter((w) => w.name.trim() === wName);
      if (hits.length === 1) warehouseId = hits[0]!.id;
      else r.fail(hits.length ? `more than one rep warehouse is named ${wName}` : `unknown warehouse: ${wName}`);
    }
    const qty = num(r, 'qty', { dp: QTY_DP, positive: true, max: QTY_MAX });
    const cost = num(r, 'unit_cost', { dp: 8, positive: false, max: QTY_MAX });
    const m = money(r);
    const expiryRaw = normalizeNumber(r.get('expiry'));
    const expiryOk = expiryRaw === '' || isIsoDate(expiryRaw);
    if (!expiryOk) r.fail(`expiry must be a date (YYYY-MM-DD): ${r.get('expiry')}`);
    const expiry = expiryOk && expiryRaw !== '' ? expiryRaw : null;
    let costIqd: DD | null = null;
    if (cost && m) {
      // the cost the stock engine stores (8 dp), so the value checked here is the value received
      costIqd = roundCost(cost.times(m.rate));
      if (costIqd.gte(QTY_MAX)) r.fail('unit cost in IQD is too large');
      else if (qty && round4(qty.times(costIqd)).gte(AMOUNT_MAX)) r.fail('the row value is too large');
    }
    if (item && warehouseId && expiryOk) {
      const key = `${item.id}|${warehouseId}|${expiry ?? ''}`;
      const first = seen.get(key);
      if (first !== undefined) r.fail(`the same item, warehouse and expiry as row ${first}`);
      else seen.set(key, r.row);
    }
    if (!r.failed() && item && warehouseId && qty && costIqd) out.push({ row: r.row, itemId: item.id, warehouseId, qty, costIqd, expiry });
  }
  return out;
}

async function checkDebts(tx: Db, rows: Row[], party: 'customer' | 'supplier'): Promise<DebtLine[]> {
  const parties = party === 'customer' ? await tx.whCustomer.findMany({ select: { id: true, name: true } }) : await tx.whSupplier.findMany({ select: { id: true, name: true } });
  const match = partyMatcher(parties);
  // (party, currency) pairs opened by an earlier import (the caller holds the opening lock, so this cannot change)
  const opened = new Set(
    (
      await tx.whOpeningDebt.findMany({
        where: party === 'customer' ? { customerId: { not: null } } : { supplierId: { not: null } },
        select: { customerId: true, supplierId: true, currency: true },
      })
    ).map((x) => `${x.customerId ?? x.supplierId}|${x.currency}`),
  );
  const seen = new Map<string, number>();
  const out: DebtLine[] = [];
  for (const r of rows) {
    const key = r.get(party);
    let partyId: string | null = null;
    if (!key) r.fail(`${party} is required`);
    else {
      const m = match(key);
      if (m === 'unknown') r.fail(`unknown ${party}: ${key}`);
      else if (m === 'ambiguous') r.fail(`more than one ${party} is named ${key}: use the id`);
      else partyId = m.id;
    }
    const amount = num(r, 'amount', { dp: 4, positive: true, max: AMOUNT_MAX });
    const m = money(r);
    let baseIqd: DD | null = null;
    if (amount && m) {
      baseIqd = round4(amount.times(m.rate));
      if (!baseIqd.gt(0)) r.fail('amount is worth less than 0.0001 IQD');
      else if (baseIqd.gte(AMOUNT_MAX)) r.fail('amount in IQD is too large');
    }
    if (partyId && m) {
      const k = `${partyId}|${m.currency}`;
      const first = seen.get(k);
      if (first !== undefined) r.fail(`the same ${party} and currency as row ${first}`);
      else if (opened.has(k)) r.fail(`this ${party} already has an opening ${m.currency} balance`);
      else seen.set(k, r.row);
    }
    if (!r.failed() && partyId && amount && m && baseIqd) out.push({ row: r.row, partyId, currency: m.currency, amount, rate: m.rate, baseIqd });
  }
  return out;
}

/** Cash currencies opened by an earlier CASH import: the CASH_<currency> lines of their entries. */
async function openedCash(tx: Db): Promise<Set<string>> {
  const entries = (await tx.whOpeningImport.findMany({ where: { kind: 'CASH' }, select: { journalEntryId: true } })).map((x) => x.journalEntryId);
  if (!entries.length) return new Set();
  const lines = await tx.whJournalLine.findMany({ where: { entryId: { in: entries }, account: { code: { startsWith: 'CASH_' } } }, select: { currency: true } });
  return new Set(lines.map((l) => l.currency));
}

function checkCash(rows: Row[], opened: Set<string>): DebtLine[] {
  const seen = new Map<string, number>();
  const out: DebtLine[] = [];
  for (const r of rows) {
    const amount = num(r, 'amount', { dp: 4, positive: true, max: AMOUNT_MAX });
    const m = money(r);
    let baseIqd: DD | null = null;
    if (amount && m) {
      baseIqd = round4(amount.times(m.rate));
      if (!baseIqd.gt(0)) r.fail('amount is worth less than 0.0001 IQD');
      else if (baseIqd.gte(AMOUNT_MAX)) r.fail('amount in IQD is too large');
      const first = seen.get(m.currency);
      if (first !== undefined) r.fail(`the same currency as row ${first}`);
      else if (opened.has(m.currency)) r.fail(`the ${m.currency} cash box already has an opening balance`);
      else seen.set(m.currency, r.row);
    }
    if (!r.failed() && amount && m && baseIqd) out.push({ row: r.row, partyId: '', currency: m.currency, amount, rate: m.rate, baseIqd });
  }
  return out;
}

const pin = (c: Currency, rate: DD) => (c === 'IQD' ? {} : { rateIqd: rate });
const sortErrors = (errors: CsvError[]) => [...errors].sort((a, b) => a.row - b.row);

/**
 * Import one kind of opening balances inside the caller's transaction. With any problem it returns `{ imported: 0, errors }` and the
 * caller MUST roll its transaction back (stock may already have been received when a later failure is found only at posting).
 * Throws ForbiddenError, OpeningImportError (kind already imported, bad opening date) or PeriodClosedError (the opening month is closed).
 */
export async function importOpeningTx(tx: Db, rid: string, user: WhUser, csv: string, kind: OpeningKind, opts: { date?: string } = {}): Promise<OpeningResult> {
  if (!canWh(user.role, 'import.apply')) throw new ForbiddenError('import.apply');
  if (!(OPENING_KINDS as readonly string[]).includes(kind)) throw new OpeningImportError(`unknown opening kind: ${String(kind)}`);
  // the import runs alone: no posting of this company meanwhile
  await lockOpening(tx, rid, 'exclusive');
  if (kind === 'STOCK' && (await tx.whOpeningImport.findFirst({ where: { kind }, select: { id: true } }))) throw new OpeningImportError('the STOCK opening balances were already imported');
  const date = await openingDate(tx, opts.date);

  const parsed = parseCsv(csv);
  const errors: CsvError[] = [...parsed.errors];
  if (parsed.header.length) checkHeader(kind, parsed.header, errors);
  if (errors.some((e) => e.row === 0)) return { imported: 0, errors };
  if (parsed.records.length === 0) return { imported: 0, errors: [...errors, { row: 0, message: 'the file has no data rows' }] };
  if (parsed.records.length > MAX_OPENING_ROWS) return { imported: 0, errors: [...errors, { row: 0, message: `at most ${MAX_OPENING_ROWS} rows per file` }] };
  const rows = rowsOf(parsed.records, parsed.header, errors);

  const importId = randomUUID();
  const ref = { type: 'OPENING', id: importId };
  let lines: LineInput[];
  let totalIqd: DD;
  let debts: DebtLine[] = [];
  let stock: StockLine[] = [];
  if (kind === 'STOCK') {
    stock = await checkStock(tx, rid, rows);
    if (errors.length) return { imported: 0, errors: sortErrors(errors) };
    totalIqd = round4(sum(stock.map((s) => s.qty.times(s.costIqd))));
    if (!totalIqd.gt(0)) return { imported: 0, errors: [{ row: 0, message: 'the opening stock has no value' }] };
    await lockStockRows(tx, rid, stock.map((s) => ({ itemId: s.itemId, warehouseId: s.warehouseId })));
    const values: DD[] = [];
    for (const s of stock) {
      const r = await receiveStock(tx, { restaurantId: rid, itemId: s.itemId, warehouseId: s.warehouseId, qtyBase: s.qty, unitCostIqd: s.costIqd, expiry: s.expiry, ref, user });
      values.push(s.qty.times(new D(r.unitCostIqd)));
    }
    // the stock engine stores the cost it was given; a difference would be a bug (throws, everything rolls back)
    if (!round4(sum(values)).eq(totalIqd)) throw new Error(`opening stock value mismatch: ${round4(sum(values)).toFixed()} != ${totalIqd.toFixed()}`);
    lines = [
      { accountCode: 'INVENTORY', side: 'DR', amount: totalIqd, currency: 'IQD' },
      { accountCode: 'PARTNER_CAPITAL', side: 'CR', amount: totalIqd, currency: 'IQD' },
    ];
  } else {
    debts = kind === 'CASH' ? checkCash(rows, await openedCash(tx)) : await checkDebts(tx, rows, kind === 'CUSTOMERS' ? 'customer' : 'supplier');
    if (errors.length) return { imported: 0, errors: sortErrors(errors) };
    totalIqd = sum(debts.map((x) => x.baseIqd));
    const capital: LineInput = { accountCode: 'PARTNER_CAPITAL', side: kind === 'SUPPLIERS' ? 'DR' : 'CR', amount: totalIqd, currency: 'IQD' };
    const each = debts.map(
      (x): LineInput =>
        kind === 'CASH'
          ? { accountCode: `CASH_${x.currency}`, side: 'DR', amount: x.amount, currency: x.currency, ...pin(x.currency, x.rate) }
          : { accountCode: kind === 'CUSTOMERS' ? 'AR' : 'AP', side: kind === 'CUSTOMERS' ? 'DR' : 'CR', amount: x.amount, currency: x.currency, partyId: x.partyId, ...pin(x.currency, x.rate) },
    );
    lines = kind === 'SUPPLIERS' ? [capital, ...each] : [...each, capital];
  }

  const { entryId } = await postJournal(tx, rid, { date, memo: `Opening balances (${kind})`, source: ref, user, lines });
  const count = kind === 'STOCK' ? stock.length : debts.length;
  await tx.whOpeningImport.create({
    data: {
      id: importId,
      restaurantId: rid,
      kind,
      date: toDbDate(date),
      rows: count,
      totalIqd: totalIqd.toFixed(),
      journalEntryId: entryId,
      userId: user.id,
    },
  });
  if (kind === 'CUSTOMERS' || kind === 'SUPPLIERS') {
    // nested creates are not stamped by the scoped client: the company id is bound here
    await tx.whOpeningDebt.createMany({
      data: debts.map((x, i) => ({
        restaurantId: rid,
        importId,
        lineNo: i + 1,
        ...(kind === 'CUSTOMERS' ? { customerId: x.partyId } : { supplierId: x.partyId }),
        currency: x.currency,
        amount: x.amount.toFixed(),
        rateIqd: x.rate.toFixed(),
        date: toDbDate(date),
      })),
    });
  }
  return { imported: count, errors: [], importId, totalIqd: totalIqd.toFixed() };
}

/** What has been imported so far, for the screen: one row per import, oldest first. */
export async function listOpeningImports(tx: Db) {
  const rows = await tx.whOpeningImport.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, kind: true, date: true, rows: true, totalIqd: true, createdAt: true } });
  return rows.map((r) => ({ id: r.id, kind: r.kind, date: isoOf(r.date), rows: r.rows, totalIqd: r.totalIqd.toString(), createdAt: r.createdAt.toISOString() }));
}
