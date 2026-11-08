import type { ClientBase } from 'pg';

/**
 * Copies one company out of the standalone Wholesale system's database into a company of this application (Phase 8).
 *
 * The standalone system's tables are this application's `Wh*` tables without the prefix and without `restaurantId`, so the
 * copy is generic: for each table, the columns both sides have are read from the source and inserted into the target with the
 * target company's id. Everything happens in ONE transaction on the target. A dry run (the default) does the whole copy,
 * checks it and rolls back, so every constraint and trigger is exercised without leaving a row behind; `apply` commits.
 *
 * What is carried: every row of the books, stock, sales, purchases and treasury, with its original ids, dates and amounts.
 * What is renumbered: the columns the database numbers itself (document numbers, the stock movement order, period event ids)
 * are given new numbers in the old order, because those numbers are unique across the whole application. What is not carried:
 * the old system's sign-in data and audit log. People are matched to this application's accounts by email; an old person with
 * no account here stops the copy until the account exists (or `allowUnmapped` says to keep the old id as it is).
 */

export interface CopyOptions {
  /** The target company (a WHOLESALE restaurant of this application). */
  restaurantId: string;
  /** The schema the old tables are in on the source connection. */
  sourceSchema?: string;
  /** False (the default): do everything, check, roll back. */
  apply?: boolean;
  /** Keep the old id of a person with no account here instead of stopping. */
  allowUnmapped?: boolean;
}

export interface CopyReport {
  applied: boolean;
  tables: { table: string; source: number; copied: number }[];
  people: { email: string; role: string; mapped: boolean }[];
  checks: { name: string; ok: boolean; detail: string }[];
  ok: boolean;
}

/** Old table name -> the target's. Order here is only a default; the real order comes from the foreign keys. */
const TABLES = [
  'ExchangeRate', 'LedgerAccount', 'JournalEntry', 'JournalLine', 'PeriodEvent', 'Item', 'ItemUnit', 'PriceListEntry', 'City', 'Customer',
  'Supplier', 'Warehouse', 'StockBalance', 'StockMovement', 'Batch', 'Purchase', 'PurchaseLine', 'LandedCost', 'LandedCostAllocation',
  'SupplierPayment', 'Setting', 'Sale', 'SaleLine', 'SaleLineBatch', 'CustomerPayment', 'SaleReturn', 'SaleReturnLine', 'SaleReturnLineBatch',
  'SaleReturnOffset', 'CurrencyConversion', 'CustodyHandover', 'CustodyHandoverLine', 'Expense', 'OpeningImport', 'OpeningDebt', 'StockCount',
  'StockCountLine', 'PurchaseReturn', 'PurchaseReturnLine',
] as const;

/** Columns the target numbers itself: not copied, so the sequences hand out fresh values in the old order. */
const SELF_NUMBERED: Record<string, string[]> = {
  JournalEntry: ['number'], PeriodEvent: ['id'], StockMovement: ['seq'], Purchase: ['number'], Sale: ['number'], SaleReturn: ['number'],
  CurrencyConversion: ['number'], CustodyHandover: ['number'], Expense: ['number'], StockCount: ['number'], PurchaseReturn: ['number'],
};

/** Columns that hold a person's id. */
const PERSON_COLUMNS = new Set(['userId', 'approvedById', 'custodyRepId', 'decidedById', 'repId', 'repUserId', 'updatedById']);

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
const CHUNK = 400;

async function columnsOf(db: ClientBase, schema: string, table: string): Promise<{ name: string; type: string }[]> {
  const res = await db.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, table],
  );
  return res.rows.map((r) => ({ name: r.column_name, type: r.data_type }));
}

/** The tables parents-first, from the target's foreign keys among them. */
async function insertOrder(target: ClientBase): Promise<string[]> {
  const names = TABLES.map((t) => `Wh${t}`);
  const res = await target.query<{ child: string; parent: string }>(
    `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
       FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`,
  );
  const unq = (s: string) => s.replaceAll('"', '').replace(/^public\./, '');
  const deps = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));
  for (const { child, parent } of res.rows) {
    const c = unq(child);
    const p = unq(parent);
    if (c !== p && deps.has(c) && deps.has(p)) deps.get(c)!.add(p);
  }
  const out: string[] = [];
  const done = new Set<string>();
  while (out.length < names.length) {
    const next = names.find((n) => !done.has(n) && [...deps.get(n)!].every((d) => done.has(d)));
    if (!next) throw new Error('foreign keys among the Wholesale tables form a cycle');
    done.add(next);
    out.push(next);
  }
  return out.map((n) => n.slice(2));
}

export async function copyCompany(source: ClientBase, target: ClientBase, opts: CopyOptions): Promise<CopyReport> {
  const schema = opts.sourceSchema ?? 'public';
  const rid = opts.restaurantId;
  const report: CopyReport = { applied: false, tables: [], people: [], checks: [], ok: false };
  const check = (name: string, ok: boolean, detail: string) => report.checks.push({ name, ok, detail });

  await target.query('BEGIN');
  try {
    const company = await target.query<{ sector: string }>('SELECT sector FROM "Restaurant" WHERE id = $1', [rid]);
    if (company.rows[0]?.sector !== 'WHOLESALE') throw new Error('the target company is not a wholesale company');
    const used = await target.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM "WhJournalEntry" WHERE "restaurantId" = $1) + (SELECT count(*) FROM "WhItem" WHERE "restaurantId" = $1) + (SELECT count(*) FROM "WhSale" WHERE "restaurantId" = $1) AS n`,
      [rid],
    );
    if (Number(used.rows[0].n) > 0) throw new Error('the target company already has Wholesale data; the copy needs an empty company');
    // A company that was only set up holds the starting chart, warehouses and cities: the copy brings its own.
    for (const t of ['WhLedgerAccount', 'WhWarehouse', 'WhCity', 'WhSetting', 'WhExchangeRate', 'WhStaff']) await target.query(`DELETE FROM ${q(t)} WHERE "restaurantId" = $1`, [rid]);

    // People: matched by email to accounts here.
    const old = await source.query<{ id: string; email: string; role: string; warehouseId: string | null; active: boolean }>(
      `SELECT id, email, role::text AS role, "warehouseId", active FROM ${q(schema)}."User"`,
    );
    const mine = await target.query<{ id: string; email: string }>('SELECT id, lower(email) AS email FROM "user"');
    const byEmail = new Map(mine.rows.map((u) => [u.email, u.id]));
    const idMap = new Map<string, string>();
    for (const u of old.rows) {
      const found = byEmail.get(u.email.toLowerCase());
      report.people.push({ email: u.email, role: u.role, mapped: !!found });
      if (found) idMap.set(u.id, found);
    }
    const unmapped = report.people.filter((p) => !p.mapped);
    check('every person has an account here', unmapped.length === 0 || !!opts.allowUnmapped, unmapped.length ? `no account for: ${unmapped.map((p) => p.email).join(', ')}` : 'all matched');
    if (unmapped.length > 0 && !opts.allowUnmapped) throw new Error(`no account here for ${unmapped.map((p) => p.email).join(', ')}`);

    const order = await insertOrder(target);
    // The tables' own triggers guard documents that are being worked on (a posted sale takes no new line); the copy brings
    // finished documents, so they are off for these tables until the copy is in, inside this same transaction (a rollback
    // brings them back). Foreign keys stay on, and the books are checked below.
    for (const table of order) await target.query(`ALTER TABLE ${q('Wh' + table)} DISABLE TRIGGER USER`);
    for (const table of order) {
      const targetName = `Wh${table}`;
      const skip = new Set(['restaurantId', ...(SELF_NUMBERED[table] ?? [])]);
      const [srcCols, tgtCols] = await Promise.all([columnsOf(source, schema, table), columnsOf(target, 'public', targetName)]);
      const srcByName = new Map(srcCols.map((c) => [c.name, c]));
      const cols = tgtCols.filter((c) => !skip.has(c.name) && srcByName.has(c.name));
      const select = cols.map((c) => (/^(numeric|bigint)$/.test(srcByName.get(c.name)!.type) ? `${q(c.name)}::text AS ${q(c.name)}` : q(c.name))).join(', ');
      const orderBy = SELF_NUMBERED[table]?.includes('number') ? 'number' : table === 'StockMovement' ? '"createdAt", seq' : table === 'PeriodEvent' ? 'id' : srcByName.has('createdAt') ? '"createdAt"' : '1';
      const rows = (await source.query<{ r: Record<string, unknown> }>(`SELECT to_jsonb(s) AS r FROM (SELECT ${select} FROM ${q(schema)}.${q(table)} ORDER BY ${orderBy}) s`)).rows.map((x) => {
        const row = { ...x.r };
        for (const c of PERSON_COLUMNS) if (typeof row[c] === 'string') row[c] = idMap.get(row[c] as string) ?? row[c];
        return row;
      });
      const colList = cols.map((c) => q(c.name)).join(', ');
      let copied = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const res = await target.query(
          `INSERT INTO ${q(targetName)} (${colList}, "restaurantId") SELECT ${colList}, $2 FROM jsonb_populate_recordset(null::${q(targetName)}, $1::jsonb)`,
          [JSON.stringify(chunk), rid],
        );
        copied += res.rowCount ?? 0;
      }
      report.tables.push({ table, source: rows.length, copied });
    }
    for (const table of order) await target.query(`ALTER TABLE ${q('Wh' + table)} ENABLE TRIGGER USER`);
    check('every table copied in full', report.tables.every((t) => t.source === t.copied), report.tables.filter((t) => t.source !== t.copied).map((t) => t.table).join(', ') || 'all counts match');

    // Staff: the old system's partners and reps become this company's staff (an owner works through the Studio membership).
    let staff = 0;
    for (const u of old.rows) {
      const id = idMap.get(u.id);
      if (!id || u.role === 'OWNER') continue;
      await target.query(
        `INSERT INTO "WhStaff" (id, "restaurantId", "userId", role, "warehouseId", "deactivatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3::"WhRole", $4, $5)`,
        [rid, id, u.role, u.role === 'REP' ? u.warehouseId : null, u.active ? null : new Date()],
      );
      staff++;
    }
    check('staff created', true, `${staff} partner and rep accounts`);

    // The books must come out the way they went in.
    const sums = async (db: ClientBase, table: string, where: string, params: unknown[]) =>
      (await db.query<{ side: string; total: string; n: string }>(`SELECT side::text AS side, coalesce(sum("baseIqd"), 0)::text AS total, count(*)::text AS n FROM ${table} ${where} GROUP BY side ORDER BY side`, params)).rows;
    const before = await sums(source, `${q(schema)}."JournalLine"`, '', []);
    const after = await sums(target, '"WhJournalLine"', 'WHERE "restaurantId" = $1', [rid]);
    check('journal totals equal the old books', JSON.stringify(before) === JSON.stringify(after), `${before.map((b) => `${b.side} ${b.total}`).join(' / ')}`);
    const unbalanced = await target.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (SELECT "entryId" FROM "WhJournalLine" WHERE "restaurantId" = $1 GROUP BY "entryId" HAVING abs(sum(CASE WHEN side = 'DR' THEN "baseIqd" ELSE -"baseIqd" END)) >= 0.01) x`,
      [rid],
    );
    check('every entry balances', unbalanced.rows[0].n === '0', `${unbalanced.rows[0].n} unbalanced`);
    const stockBefore = await source.query<{ s: string }>(`SELECT coalesce(sum("qtyBase"), 0)::text AS s FROM ${q(schema)}."StockBalance"`);
    const stockAfter = await target.query<{ s: string }>(`SELECT coalesce(sum("qtyBase"), 0)::text AS s FROM "WhStockBalance" WHERE "restaurantId" = $1`, [rid]);
    check('stock on hand equals the old stock', Number(stockBefore.rows[0].s) === Number(stockAfter.rows[0].s), stockAfter.rows[0].s);

    report.ok = report.checks.every((c) => c.ok);
    if (opts.apply && report.ok) {
      await target.query('COMMIT');
      report.applied = true;
    } else {
      await target.query('ROLLBACK');
    }
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  }
  return report;
}
