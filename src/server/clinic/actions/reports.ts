import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction } from '../framework';
import { dayRange, isDay, localDay } from '../time';

/**
 * The owner's reports, worked out from bills and payments on demand. Doctor shares come from what was actually
 * collected (`paid`), never from the billed total:
 *   PERCENT  the doctor keeps that percent of what was collected
 *   FIXED    the doctor gets a fixed sum for each visit that brought money, never more than that visit collected
 *   RENT     the doctor pays the clinic a rent for each day they saw patients and keeps the rest, never below zero
 * No clinical text is read.
 */

const day = z.string().refine(isDay, 'A date as YYYY-MM-DD');
const MAX_DAYS = 366;
const DAY_MS = 86_400_000;

export const dayReport = defineClAction({
  name: 'clinic.reports.day',
  roles: ['OWNER'],
  input: z.object({ day: day.optional() }),
  run: async (ctx, input) => {
    const when = input.day ?? localDay(new Date());
    const { start, end } = dayRange(when);
    const [visits, billed, debts, payments] = await Promise.all([
      ctx.db.clVisit.count({ where: { ticket: { day: when } } }),
      ctx.db.clBill.aggregate({ where: { ticket: { day: when } }, _sum: { total: true } }),
      ctx.db.clBill.findMany({ where: { ticket: { day: when }, status: 'DEBT' }, select: { total: true, paid: true } }),
      ctx.db.clPayment.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { currency: true, tendered: true, appliedIqd: true, changeIqd: true, shiftId: true } }),
    ]);
    return {
      day: when,
      visits,
      billed: billed._sum.total ?? 0,
      appliedIqd: payments.reduce((sum, p) => sum + p.appliedIqd, 0),
      receivedIqd: payments.filter((p) => p.currency === 'IQD').reduce((sum, p) => sum + p.tendered, 0),
      receivedUsdCents: payments.filter((p) => p.currency === 'USD').reduce((sum, p) => sum + p.tendered, 0),
      changeIqd: payments.reduce((sum, p) => sum + p.changeIqd, 0),
      debtCount: debts.length,
      debtBalance: debts.reduce((sum, b) => sum + (b.total - b.paid), 0),
      unshiftedPayments: payments.filter((p) => p.shiftId === null).length,
    };
  },
});

export const doctorShares = defineClAction({
  name: 'clinic.reports.doctorShares',
  roles: ['OWNER'],
  input: z.object({ fromDay: day, toDay: day }),
  run: async (ctx, { fromDay, toDay }) => {
    const span = (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS;
    if (span < 0) throw new StudioError('INVALID', 'The range ends before it starts');
    if (span >= MAX_DAYS) throw new StudioError('INVALID', 'Choose a range of a year or less');
    // A course sale is money for the course, not a visit: it earns no per-visit sum and is no day worked.
    const sold = await ctx.db.clPatientPackage.findMany({ where: { billId: { not: null } }, select: { billId: true } });
    const saleBillIds = sold.flatMap((s) => (s.billId ? [s.billId] : []));
    const [doctors, bills] = await Promise.all([
      ctx.db.clDoctor.findMany({ include: { member: { select: { account: { select: { name: true } } } } } }),
      ctx.db.clBill.findMany({ where: { ticket: { day: { gte: fromDay, lte: toDay } }, id: { notIn: saleBillIds } }, select: { doctorId: true, total: true, paid: true, ticket: { select: { day: true } } } }),
    ]);
    return doctors.map((d) => {
      const own = bills.filter((b) => b.doctorId === d.id);
      const billed = own.reduce((sum, b) => sum + b.total, 0);
      const collected = own.reduce((sum, b) => sum + b.paid, 0);
      let doctorShare: number;
      if (d.shareMode === 'PERCENT') doctorShare = Math.floor((collected * d.shareValue) / 100);
      else if (d.shareMode === 'FIXED') doctorShare = own.reduce((sum, b) => sum + (b.paid > 0 ? Math.min(b.paid, d.shareValue) : 0), 0);
      else doctorShare = Math.max(0, collected - new Set(own.map((b) => b.ticket.day)).size * d.shareValue);
      doctorShare = Math.min(doctorShare, collected);
      return { doctorId: d.id, name: d.member.account.name, mode: d.shareMode, value: d.shareValue, visits: own.length, billed, collected, doctorShare, clinicShare: collected - doctorShare };
    });
  },
});

const BUCKETS = ['NOT_DUE', 'D1_30', 'D31_60', 'D61_PLUS'] as const;
const bucketOf = (overdue: number) => (overdue <= 0 ? 'NOT_DUE' : overdue <= 30 ? 'D1_30' : overdue <= 60 ? 'D31_60' : 'D61_PLUS');

/** Debts by how late they are: a debt due today is not late. For the owner, the desk and the till. */
export const agedDebts = defineClAction({
  name: 'clinic.reports.agedDebts',
  roles: ['OWNER', 'RECEPTION', 'CASHIER'],
  input: z.object({}),
  run: async (ctx) => {
    const today = localDay(new Date());
    // Every debt feeds the buckets, so the totals are true; only the list shown is cut, oldest due day first.
    const debts = await ctx.db.clBill.findMany({ where: { status: 'DEBT' }, include: { patient: { select: { name: true, phone: true } } }, orderBy: [{ dueDay: 'asc' }, { id: 'asc' }] });
    const all = debts
      .map((b) => {
        const overdue = b.dueDay ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${b.dueDay}T00:00:00Z`)) / DAY_MS) : 0;
        return { billId: b.id, patientName: b.patient.name, patientPhone: b.patient.phone, balance: b.total - b.paid, dueDay: b.dueDay, daysOverdue: Math.max(0, overdue) };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
    const rows = all.slice(0, 500);
    const buckets = BUCKETS.map((key) => {
      const own = all.filter((r) => bucketOf(r.daysOverdue) === key);
      return { key, count: own.length, balance: own.reduce((sum, r) => sum + r.balance, 0) };
    });
    return { buckets, rows };
  },
});
