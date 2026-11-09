import { NextResponse } from 'next/server';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { debtorsReportQuery, expensesReportQuery, salesBreakdownQuery, stockReportQuery } from '@/server/wholesale/queries/reports';

/** CSV downloads of the reports (a BOM first, so Excel reads Arabic and Kurdish names right). Partners only. */

const KINDS = ['sales-customers', 'sales-items', 'expenses', 'stock', 'debts'] as const;
type Kind = (typeof KINDS)[number];
const cell = (v: unknown) => {
  const t = String(v ?? '');
  // a leading = + - @ would run as a formula in a spreadsheet
  const safe = /^[=+\-@]/.test(t) && Number.isNaN(Number(t)) ? `'${t}` : t;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const line = (cells: unknown[]) => cells.map(cell).join(',');
const names = (n: unknown) => {
  const o = (n ?? {}) as Record<string, string>;
  return o.ar || o.ckb || o.en || '';
};
const day = (v: string | null, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);

export async function GET(request: Request) {
  const { actor } = await getWhAccess();
  if (!actor || !canWh(actor.role, 'report.view')) return new NextResponse('Forbidden', { status: 403 });
  const sp = new URL(request.url).searchParams;
  const kind = sp.get('kind') as Kind;
  if (!KINDS.includes(kind)) return new NextResponse('Unknown report', { status: 400 });
  const today = baghdadDate();
  const from = day(sp.get('from'), `${today.slice(0, 7)}-01`);
  const to = day(sp.get('to'), today);
  const rows: string[] = [];
  if (kind === 'sales-customers') {
    const r = await queryWh(salesBreakdownQuery, { from, to });
    rows.push(line(['customer', 'sales', 'currency', 'total']));
    for (const c of r.customers) for (const [cur, v] of Object.entries(c.byCurrency)) rows.push(line([c.name, c.count, cur, v]));
  } else if (kind === 'sales-items') {
    const r = await queryWh(salesBreakdownQuery, { from, to });
    rows.push(line(['code', 'item', 'quantity (base unit)', 'currency', 'total']));
    for (const c of r.items) for (const [cur, v] of Object.entries(c.byCurrency)) rows.push(line([c.code, names(c.names), c.qty, cur, v]));
  } else if (kind === 'expenses') {
    const r = await queryWh(expensesReportQuery, { from, to });
    rows.push(line(['category', 'currency', 'total']));
    for (const e of r) for (const [cur, v] of Object.entries(e.byCurrency)) rows.push(line([e.category, cur, v]));
  } else if (kind === 'stock') {
    const r = await queryWh(stockReportQuery);
    rows.push(line(['code', 'item', 'warehouse', 'quantity (base unit)', 'value IQD']));
    for (const x of r.rows) rows.push(line([x.code, names(x.names), x.warehouse, x.qtyBase, Math.round(Number(x.valueIqd) * 10000) / 10000]));
  } else {
    const r = await queryWh(debtorsReportQuery);
    rows.push(line(['side', 'name', 'currency', 'balance']));
    for (const c of r.customers) for (const [cur, v] of Object.entries(c.balances)) rows.push(line(['customer owes', c.name, cur, v]));
    for (const c of r.suppliers) for (const [cur, v] of Object.entries(c.balances)) rows.push(line(['owed to supplier', c.name, cur, v]));
  }
  return new NextResponse('\uFEFF' + rows.join('\r\n') + '\r\n', {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="wholesale-${kind}-${from}_${to}.csv"`, 'cache-control': 'no-store' },
  });
}
