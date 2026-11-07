import { z } from 'zod';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { getPurchase, listPurchases, openPayables, supplierStatement } from '@/server/wholesale/posting/purchase';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reads of the purchases side of a wholesale company (Phase 3). Purchases carry cost, so only the partners read them. Money
 * leaves the server as text and dates as `YYYY-MM-DD`: no decimal, bigint or Date crosses to the screen.
 */

function scopedOf(ctx: { wh: import('@/server/wholesale/actor').WhActor | null; scoped: import('@/server/data/tenant-db').ScopedClient | null }) {
  if (!ctx.wh || !ctx.scoped) throw new Error('A wholesale query ran without a wholesale actor');
  return ctx.scoped;
}

const isoOf = (d: Date): string => d.toISOString().slice(0, 10);
const idInput = whPlaceInput.extend({ id: z.string().min(1).max(64) });

export const ratesQuery = defineQuery({
  name: 'wh.rates',
  permission: null,
  wh: 'purchase.manage',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const rows = await scopedOf(ctx).whExchangeRate.findMany({ orderBy: [{ date: 'desc' }, { currency: 'asc' }], take: 30 });
    return { today: baghdadDate(), rates: rows.map((r) => ({ date: isoOf(r.date), currency: r.currency, iqdPer: r.iqdPer.toFixed() })) };
  },
});

export const purchasesQuery = defineQuery({
  name: 'wh.purchases',
  permission: null,
  wh: 'purchase.manage',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const rows = await listPurchases(scopedOf(ctx));
    return rows.map((p) => ({
      id: p.id,
      number: p.number.toString(),
      date: p.date,
      supplierId: p.supplier.id,
      supplierName: p.supplier.name,
      currency: p.currency,
      paymentMode: p.paymentMode,
      status: p.status,
      totalOriginal: p.totalOriginal.toFixed(),
      totalIqd: p.totalIqd.toFixed(),
    }));
  },
});

export const purchaseQuery = defineQuery({
  name: 'wh.purchase',
  permission: null,
  wh: 'purchase.manage',
  input: idInput,
  target: whTargetOf,
  run: async (ctx, { id }) => {
    const p = await getPurchase(scopedOf(ctx), id);
    if (!p) return null;
    return {
      id: p.id,
      number: p.number.toString(),
      date: p.date,
      dueDate: p.dueDate,
      supplier: p.supplier,
      warehouse: p.warehouse,
      currency: p.currency,
      paymentMode: p.paymentMode,
      status: p.status,
      totalOriginal: p.totalOriginal.toFixed(),
      totalIqd: p.totalIqd.toFixed(),
      open: p.open.toFixed(),
      paid: p.paidInPurchaseCcy.toFixed(),
      cancelReason: p.cancelReason,
      lines: p.lines.map((l) => ({
        id: l.id,
        itemCode: l.item.code,
        itemNames: l.itemNames,
        unit: l.unit,
        qty: l.qty.toFixed(),
        unitPrice: l.unitPrice.toFixed(),
        lineTotal: l.lineTotal.toFixed(),
        expiry: l.expiry,
      })),
      landedCosts: p.landedCosts.map((c) => ({ id: c.id, kind: c.kind, amount: c.amount.toFixed(), currency: c.currency, date: c.date, amountIqd: c.amountIqd.toFixed(), paymentMode: c.paymentMode })),
      payments: p.payments.map((x) => ({ id: x.id, amount: x.amount.toFixed(), currency: x.currency, date: x.date, settled: x.settledInPurchaseCcy.toFixed() })),
      returns: p.returns.map((r) => ({ id: r.id, date: r.date, refund: r.refund, totalValue: r.totalValue.toFixed(), currency: r.currency })),
    };
  },
});

export const supplierStatementQuery = defineQuery({
  name: 'wh.supplier.statement',
  permission: null,
  wh: 'purchase.manage',
  input: idInput,
  target: whTargetOf,
  run: async (ctx, { id }) => {
    const st = await supplierStatement(scopedOf(ctx), id);
    return {
      rows: st.rows.map((r) => ({
        date: r.date,
        kind: r.kind,
        purchaseId: r.purchaseId,
        purchaseNumber: r.purchaseNumber,
        currency: r.currency,
        charge: r.charge.toFixed(),
        paid: r.paid.toFixed(),
        paidAmount: r.paidAmount?.toFixed() ?? null,
        paidCurrency: r.paidCurrency,
        balance: r.balance.toFixed(),
      })),
      balances: Object.entries(st.balances).map(([currency, amount]) => ({ currency, amount: amount!.toFixed() })),
    };
  },
});

export const payablesQuery = defineQuery({
  name: 'wh.supplier.payables',
  permission: null,
  wh: 'purchase.manage',
  input: idInput,
  target: whTargetOf,
  run: async (ctx, { id }) => {
    const docs = await openPayables(scopedOf(ctx), id);
    return docs.map((d) => ({ kind: d.kind, id: d.id, number: d.number?.toString() ?? null, currency: d.currency, open: d.open.toFixed(), date: d.date, dueDate: d.dueDate }));
  },
});
