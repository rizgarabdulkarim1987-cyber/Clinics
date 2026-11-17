import { z } from 'zod';
import { defineClAction } from '../framework';
import { dayRange, localDay } from '../time';

/**
 * The home summary: today's queue and bookings, tomorrow's reminders still to send, and, for the owner only, what was
 * collected today, what is owed, and the share of booked visits missed in the last 30 days. Counts and money only.
 */

const DAY_MS = 86_400_000;

export const homeSummary = defineClAction({
  name: 'clinic.home.summary',
  roles: ['OWNER', 'RECEPTION'],
  input: z.object({}),
  run: async (ctx) => {
    const now = new Date();
    const today = localDay(now);
    const tomorrow = dayRange(localDay(new Date(now.getTime() + DAY_MS)));
    const todayRange = dayRange(today);
    const [waiting, withDoctor, toPay, bookingsToday, bookingsTomorrow, unreminded] = await Promise.all([
      ctx.db.clTicket.count({ where: { day: today, status: 'WAITING' } }),
      ctx.db.clTicket.count({ where: { day: today, status: 'WITH_DOCTOR' } }),
      ctx.db.clTicket.count({ where: { day: today, status: 'TO_PAY' } }),
      ctx.db.clBooking.count({ where: { status: { in: ['BOOKED', 'CHECKED_IN'] }, startsAt: { gte: todayRange.start, lt: todayRange.end } } }),
      ctx.db.clBooking.count({ where: { status: 'BOOKED', startsAt: { gte: tomorrow.start, lt: tomorrow.end } } }),
      ctx.db.clBooking.count({ where: { status: 'BOOKED', remindedAt: null, startsAt: { gte: tomorrow.start, lt: tomorrow.end } } }),
    ]);
    let owner: { collectedToday: number; debt: number; noShowPercent: number } | null = null;
    if (ctx.member.role === 'OWNER') {
      const since = new Date(now.getTime() - 30 * DAY_MS);
      const [paid, debts, done, missed] = await Promise.all([
        ctx.db.clPayment.aggregate({ where: { createdAt: { gte: todayRange.start, lt: todayRange.end } }, _sum: { appliedIqd: true } }),
        ctx.db.clBill.findMany({ where: { status: 'DEBT' }, select: { total: true, paid: true } }),
        ctx.db.clBooking.count({ where: { status: 'DONE', startsAt: { gte: since, lt: now } } }),
        ctx.db.clBooking.count({ where: { status: 'NO_SHOW', startsAt: { gte: since, lt: now } } }),
      ]);
      owner = {
        collectedToday: paid._sum.appliedIqd ?? 0,
        debt: debts.reduce((sum, b) => sum + (b.total - b.paid), 0),
        noShowPercent: done + missed === 0 ? 0 : Math.round((missed * 100) / (done + missed)),
      };
    }
    return { queue: { waiting, withDoctor, toPay }, bookingsToday, bookingsTomorrow, unreminded, owner };
  },
});
