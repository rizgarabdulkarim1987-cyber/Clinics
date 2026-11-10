import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { agencyExportQuery } from '@/server/wholesale/queries/agency';
import { debtorsReportQuery, expensesReportQuery, movementsExportQuery, salesBreakdownQuery, stockReportQuery } from '@/server/wholesale/queries/reports';

/**
 * Spreadsheet downloads of the reports and of every sale and purchase. `format=xlsx` (the default) is a real Excel file, one
 * sheet per table; `format=csv` is the same table as text (a BOM first, so Excel reads Arabic and Kurdish right). Partners only.
 */

const KINDS = ['all', 'sales-all', 'purchases-all', 'sales-customers', 'sales-items', 'expenses', 'stock', 'debts', 'agency'] as const;
type Kind = (typeof KINDS)[number];
type Table = { name: string; head: string[]; rows: unknown[][] };

const names = (n: unknown) => {
  const o = (n ?? {}) as Record<string, string>;
  return o.ar || o.ckb || o.en || '';
};
const day = (v: string | null, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : Number(v));
/** A leading = + - @ would run as a formula in a spreadsheet. */
const text = (v: unknown) => {
  const t = String(v ?? '');
  return /^[=+\-@]/.test(t) && Number.isNaN(Number(t)) ? `'${t}` : t;
};

async function build(kind: Exclude<Kind, 'all'>, from: string, to: string): Promise<Table[]> {
  if (kind === 'sales-all') {
    const r = await queryWh(movementsExportQuery, { from, to });
    const rows: unknown[][] = [];
    for (const s of r.sales) {
      const c = s.customer;
      const base = [Number(s.number), String(s.date).slice(0, 10), c.name, c.ownerName ?? '', c.phone ?? '', names(c.city.name), c.address ?? '', s.paymentMode, s.status, s.currency];
      if (s.lines.length === 0) rows.push([...base, '', '', '', '', '', '', num(s.totalFinal)]);
      for (const l of s.lines) rows.push([...base, l.item.code, names(l.item.names), num(l.qty), l.unit, num(l.finalPrice), num(l.lineTotal), num(s.totalFinal)]);
    }
    return [{ name: 'Sales', head: ['Invoice', 'Date', 'Shop', 'Owner', 'Phone', 'Province', 'Address', 'Payment', 'Status', 'Currency', 'Item code', 'Item', 'Qty', 'Unit', 'Price', 'Line total', 'Invoice total'], rows }];
  }
  if (kind === 'purchases-all') {
    const r = await queryWh(movementsExportQuery, { from, to });
    const rows: unknown[][] = [];
    for (const p of r.purchases) {
      const base = [Number(p.number), String(p.date).slice(0, 10), p.supplier.name, p.paymentMode, p.status, p.currency];
      if (p.lines.length === 0) rows.push([...base, '', '', '', '', '', '', num(p.totalOriginal)]);
      for (const l of p.lines) rows.push([...base, l.item.code, names(l.item.names), num(l.qty), l.unit, num(l.unitPrice), num(l.lineTotal), num(p.totalOriginal)]);
    }
    return [{ name: 'Purchases', head: ['Purchase', 'Date', 'Supplier', 'Payment', 'Status', 'Currency', 'Item code', 'Item', 'Qty', 'Unit', 'Price', 'Line total', 'Purchase total'], rows }];
  }
  if (kind === 'sales-customers') {
    const r = await queryWh(salesBreakdownQuery, { from, to });
    return [{ name: 'Sales by shop', head: ['Shop', 'Invoices', 'Currency', 'Total'], rows: r.customers.flatMap((c) => Object.entries(c.byCurrency).map(([cur, v]) => [c.name, c.count, cur, num(v)])) }];
  }
  if (kind === 'sales-items') {
    const r = await queryWh(salesBreakdownQuery, { from, to });
    return [{ name: 'Sales by item', head: ['Code', 'Item', 'Quantity (base unit)', 'Currency', 'Total'], rows: r.items.flatMap((c) => Object.entries(c.byCurrency).map(([cur, v]) => [c.code, names(c.names), num(c.qty), cur, num(v)])) }];
  }
  if (kind === 'expenses') {
    const r = await queryWh(expensesReportQuery, { from, to });
    return [{ name: 'Expenses', head: ['Category', 'Currency', 'Total'], rows: r.flatMap((e) => Object.entries(e.byCurrency).map(([cur, v]) => [e.category, cur, num(v)])) }];
  }
  if (kind === 'stock') {
    const r = await queryWh(stockReportQuery);
    return [{ name: 'Stock', head: ['Code', 'Item', 'Warehouse', 'Quantity (base unit)', 'Value IQD'], rows: r.rows.map((x) => [x.code, names(x.names), x.warehouse, num(x.qtyBase), Math.round(Number(x.valueIqd) * 10000) / 10000]) }];
  }
  if (kind === 'agency') {
    const orders = await queryWh(agencyExportQuery, { from, to });
    return [
      {
        name: 'Special orders',
        head: ['Order', 'Date', 'Customer', 'Product', 'Status', 'Currency', 'Agreed total', 'Advances received', 'Cost paid', 'Sale total', 'Profit (loss)', 'Advances held', 'Owed by customer'],
        rows: orders.map((o) => [Number(o.number), String(o.date).slice(0, 10), o.principal.name, o.title, o.status, o.currency, num(o.agreedTotal), num(o.balance.advanceReceived), num(o.balance.costs), num(o.balance.saleTotal), num(o.balance.profit), num(o.balance.advanceHeld), num(o.balance.receivable)]),
      },
      {
        name: 'Special order steps',
        head: ['Order', 'Date', 'Customer', 'Step', 'Kind', 'Currency', 'Amount', 'Note'],
        rows: orders.flatMap((o) => o.movements.map((m) => [Number(o.number), String(m.date).slice(0, 10), o.principal.name, m.kind, m.category ?? '', o.currency, num(m.amount), m.note ?? ''])),
      },
    ];
  }
  const r = await queryWh(debtorsReportQuery);
  return [
    {
      name: 'Debts',
      head: ['Side', 'Name', 'Currency', 'Balance'],
      rows: [
        ...r.customers.flatMap((c) => Object.entries(c.balances).map(([cur, v]) => ['Shop owes', c.name, cur, num(v)])),
        ...r.suppliers.flatMap((c) => Object.entries(c.balances).map(([cur, v]) => ['Owed to supplier', c.name, cur, num(v)])),
      ],
    },
  ];
}

export async function GET(request: Request) {
  const { actor } = await getWhAccess();
  if (!actor || !canWh(actor.role, 'report.view')) return new NextResponse('Forbidden', { status: 403 });
  const sp = new URL(request.url).searchParams;
  const kind = sp.get('kind') as Kind;
  if (!KINDS.includes(kind)) return new NextResponse('Unknown report', { status: 400 });
  const today = baghdadDate();
  const from = day(sp.get('from'), `${today.slice(0, 7)}-01`);
  const to = day(sp.get('to'), today);
  const csv = sp.get('format') === 'csv';
  const tables =
    kind === 'all'
      ? (await Promise.all((['sales-all', 'purchases-all', 'sales-customers', 'sales-items', 'expenses', 'stock', 'debts', 'agency'] as const).map((k) => build(k, from, to)))).flat()
      : await build(kind, from, to);
  const file = `wholesale-${kind}-${from}_${to}`;
  if (csv) {
    const cell = (v: unknown) => {
      const t = text(v);
      return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const body = tables.flatMap((t, i) => [...(tables.length > 1 ? [`${i ? '\r\n' : ''}${cell(t.name)}`] : []), t.head.map(cell).join(','), ...t.rows.map((r) => r.map(cell).join(','))]).join('\r\n');
    return new NextResponse('﻿' + body + '\r\n', { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${file}.csv"`, 'cache-control': 'no-store' } });
  }
  const book = new ExcelJS.Workbook();
  book.creator = actor.restaurantName;
  for (const t of tables) {
    const sheet = book.addWorksheet(t.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1, rightToLeft: actor.locale !== 'en' }] });
    sheet.addRow(t.head);
    for (const r of t.rows) sheet.addRow(r.map((v) => (typeof v === 'string' ? text(v) : v)));
    const head = sheet.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12294B' } };
    sheet.columns.forEach((col, i) => {
      const widest = Math.max(String(t.head[i] ?? '').length, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? '').length));
      col.width = Math.min(Math.max(widest + 2, 8), 42);
    });
  }
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${file}.xlsx"`, 'cache-control': 'no-store' },
  });
}
