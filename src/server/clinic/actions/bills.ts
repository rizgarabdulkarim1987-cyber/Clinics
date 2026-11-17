import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction, type ClContext } from '../framework';
import { earnForBill } from '../loyalty';
import { isDay, localDay } from '../time';

/**
 * The cashier. A bill is priced when the visit ends; here a line can be added or removed while it is open, money is taken
 * in dinar or dollar, and what is left can become a debt with a due day. Money is whole dinars; a dollar payment is entered
 * in cents and converted at the clinic's rate, which is written on the payment row so a later rate never changes it.
 * Change is always returned in dinar. A payment is applied with a guarded update ("only if nobody has paid since I read
 * it"), so two clicks at once can never take a bill past paid. No clinical text is read here.
 */

const BILL_ROLES = ['OWNER', 'RECEPTION', 'CASHIER'] as const;
const idField = z.string().min(1).max(64);
const DEFAULT_RATE = 1500;

async function billFor(ctx: ClContext, billId: string) {
  const bill = await ctx.db.clBill.findFirst({ where: { id: billId } });
  if (!bill) throw new StudioError('NOT_FOUND');
  return bill;
}

/** The ticket moves to Done once its bill is settled or left as a debt. */
async function closeTicket(ctx: ClContext, ticketId: string) {
  await ctx.db.clTicket.updateMany({ where: { id: ticketId, status: 'TO_PAY' }, data: { status: 'DONE' } });
}

export const getRate = defineClAction({
  name: 'clinic.bills.getRate',
  roles: [...BILL_ROLES],
  input: z.object({}),
  run: async (ctx) => {
    const settings = await ctx.db.clSettings.findFirst({});
    return { usdRate: settings?.usdRate ?? DEFAULT_RATE, currencies: settings?.enabledCurrencies ?? (['IQD', 'USD'] as ('IQD' | 'USD')[]) };
  },
});

export const saveRate = defineClAction({
  name: 'clinic.bills.saveRate',
  roles: ['OWNER'],
  input: z.object({ usdRate: z.number().int().min(100).max(100000) }),
  run: async (ctx, { usdRate }) => {
    const row = await ctx.db.clSettings.findFirst({});
    if (row) await ctx.db.clSettings.updateMany({ where: { id: row.id }, data: { usdRate } });
    else await ctx.db.clSettings.create({ data: { restaurantId: ctx.restaurantId, usdRate } });
    ctx.audit({ action: 'clinic.rate_saved', entityType: 'ClSettings', entityId: row?.id ?? ctx.restaurantId, changes: { usdRate: { before: row?.usdRate ?? DEFAULT_RATE, after: usdRate } } });
    return null;
  },
});

export const listBills = defineClAction({
  name: 'clinic.bills.list',
  roles: [...BILL_ROLES],
  input: z.object({ status: z.enum(['OPEN', 'PAID', 'DEBT']).optional() }),
  run: async (ctx, { status }) => {
    const rows = await ctx.db.clBill.findMany({
      where: { status: status ?? 'OPEN' },
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        patient: { select: { name: true, phone: true, householdId: true } },
        ticket: { select: { number: true, day: true } },
        doctor: { select: { member: { select: { account: { select: { name: true } } } } } },
      },
      orderBy: { createdAt: status === undefined || status === 'OPEN' ? 'asc' : 'desc' },
      take: 200,
    });
    // The household cards of the open bills, in one query, so the till can offer a full card without asking per bill.
    const settings = await ctx.db.clSettings.findFirst({});
    const loyaltyOn = (settings?.loyaltyEnabled ?? false) && (status === undefined || status === 'OPEN');
    const households = new Map(rows.map((b) => [b.patientId, b.patient.householdId]));
    const sums = loyaltyOn ? await ctx.db.clLoyaltyEntry.groupBy({ by: ['householdId'], where: { householdId: { in: [...new Set(households.values())] } }, _sum: { delta: true } }) : [];
    const stampsOf = new Map(sums.map((s) => [s.householdId, s._sum.delta ?? 0]));
    return rows.map((b) => ({
      loyalty: loyaltyOn ? { stamps: stampsOf.get(b.patient.householdId) ?? 0, every: settings?.loyaltyEvery ?? 5, rewardIqd: settings?.loyaltyRewardIqd ?? 5000 } : null,
      billId: b.id,
      status: b.status,
      number: b.ticket.number,
      day: b.ticket.day,
      patientName: b.patient.name,
      patientPhone: b.patient.phone,
      doctorName: b.doctor.member.account.name,
      total: b.total,
      paid: b.paid,
      balance: b.total - b.paid,
      dueDay: b.dueDay,
      lines: b.lines.map((l) => ({ lineId: l.id, label: l.label, amount: l.amount })),
    }));
  },
});

export const addBillLine = defineClAction({
  name: 'clinic.bills.addLine',
  roles: [...BILL_ROLES],
  input: z.object({ billId: idField, label: z.string().trim().min(1).max(80), amount: z.number().int().min(1).max(1_000_000_000) }),
  run: async (ctx, { billId, label, amount }) => {
    const bill = await billFor(ctx, billId);
    const { count } = await ctx.db.clBill.updateMany({ where: { id: billId, status: 'OPEN', version: bill.version }, data: { total: { increment: amount }, version: { increment: 1 } } });
    if (count === 0) throw new StudioError('INVALID', 'This bill can no longer be changed');
    const line = await ctx.db.clBillLine.create({ data: { restaurantId: ctx.restaurantId, billId, label, amount, sortOrder: 100 } });
    ctx.audit({ action: 'clinic.bill_line_added', entityType: 'ClBill', entityId: billId, changes: { amount: { before: null, after: amount } } });
    return { lineId: line.id };
  },
});

export const removeBillLine = defineClAction({
  name: 'clinic.bills.removeLine',
  roles: [...BILL_ROLES],
  input: z.object({ lineId: idField }),
  run: async (ctx, { lineId }) => {
    const line = await ctx.db.clBillLine.findFirst({ where: { id: lineId } });
    if (!line) throw new StudioError('NOT_FOUND');
    // A spent loyalty reward is a negative line; taking it off would give the stamps away for nothing.
    if (line.amount < 0) throw new StudioError('INVALID', 'This line cannot be removed');
    const bill = await billFor(ctx, line.billId);
    if (bill.total - line.amount < bill.paid) throw new StudioError('INVALID', 'The bill would be less than what was paid');
    const { count } = await ctx.db.clBill.updateMany({ where: { id: bill.id, status: 'OPEN', version: bill.version }, data: { total: { decrement: line.amount }, version: { increment: 1 } } });
    if (count === 0) throw new StudioError('INVALID', 'This bill can no longer be changed');
    await ctx.db.clBillLine.deleteMany({ where: { id: lineId } });
    ctx.audit({ action: 'clinic.bill_line_removed', entityType: 'ClBill', entityId: bill.id, changes: { amount: { before: line.amount, after: null } } });
    return null;
  },
});

export const takePayment = defineClAction({
  name: 'clinic.bills.takePayment',
  roles: [...BILL_ROLES],
  input: z.object({ billId: idField, currency: z.enum(['IQD', 'USD']), amount: z.number().int().min(1).max(1_000_000_000) }),
  run: async (ctx, { billId, currency, amount }) => {
    const bill = await billFor(ctx, billId);
    if (bill.status === 'PAID') throw new StudioError('INVALID', 'This bill is already paid');
    const settings = await ctx.db.clSettings.findFirst({});
    if (settings && !settings.enabledCurrencies.includes(currency)) throw new StudioError('INVALID', 'This currency is not accepted');
    const rate = settings?.usdRate ?? DEFAULT_RATE;
    const due = bill.total - bill.paid;
    if (due <= 0) throw new StudioError('INVALID', 'There is nothing to pay');
    const converted = currency === 'IQD' ? amount : Math.round((amount * rate) / 100);
    if (converted < 1) throw new StudioError('INVALID', 'The amount is too small');
    const applied = Math.min(due, converted);
    const changeIqd = converted - applied;
    const paid = bill.paid + applied;
    const settled = paid >= bill.total;
    const { count } = await ctx.db.clBill.updateMany({
      // The version covers a line added or removed since the read: `settled` above was worked out from that read's total.
      where: { id: billId, paid: bill.paid, version: bill.version, status: { in: ['OPEN', 'DEBT'] } },
      data: { paid, version: { increment: 1 }, ...(settled ? { status: 'PAID' as const, closedAt: new Date() } : {}) },
    });
    if (count === 0) throw new StudioError('INVALID', 'This bill changed, check it and try again');
    const shift = await ctx.db.clShift.findFirst({ where: { status: 'OPEN' }, select: { id: true } });
    await ctx.db.clPayment.create({
      data: { restaurantId: ctx.restaurantId, billId, currency, tendered: amount, rate, appliedIqd: applied, changeIqd, takenById: ctx.member.memberId, shiftId: shift?.id ?? null },
    });
    if (settled) {
      await closeTicket(ctx, bill.ticketId);
      await earnForBill(ctx, { id: bill.id, patientId: bill.patientId, total: bill.total });
    }
    ctx.audit({ action: 'clinic.payment_taken', entityType: 'ClBill', entityId: billId, changes: { paid: { before: bill.paid, after: paid } } });
    return { appliedIqd: applied, changeIqd, balance: bill.total - paid, status: settled ? ('PAID' as const) : bill.status };
  },
});

export const leaveAsDebt = defineClAction({
  name: 'clinic.bills.leaveAsDebt',
  roles: [...BILL_ROLES],
  input: z.object({ billId: idField, dueDay: z.string().refine(isDay, 'A date as YYYY-MM-DD') }),
  run: async (ctx, { billId, dueDay }) => {
    const bill = await billFor(ctx, billId);
    if (bill.status !== 'OPEN') throw new StudioError('INVALID', 'This bill is not open');
    if (bill.total - bill.paid <= 0) throw new StudioError('INVALID', 'There is nothing left to owe');
    if (dueDay < localDay(new Date())) throw new StudioError('INVALID', 'The due day has passed');
    const { count } = await ctx.db.clBill.updateMany({ where: { id: billId, status: 'OPEN', paid: bill.paid, version: bill.version }, data: { status: 'DEBT', dueDay, closedAt: new Date(), version: { increment: 1 } } });
    if (count === 0) throw new StudioError('INVALID', 'This bill changed, check it and try again');
    await closeTicket(ctx, bill.ticketId);
    ctx.audit({ action: 'clinic.bill_debt', entityType: 'ClBill', entityId: billId, changes: { dueDay: { before: null, after: dueDay } } });
    return null;
  },
});
