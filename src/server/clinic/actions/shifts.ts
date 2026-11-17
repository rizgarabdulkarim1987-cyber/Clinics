import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction, type ClContext } from '../framework';

/**
 * The till shift. It opens with a float in dinars; payments taken while it is open join it. At the close the counted
 * dinars and dollars are compared with what the payments say the drawer should hold:
 *   dinars  = float + dinars handed over in dinar payments - all change given (dinar change on a dollar payment too)
 *   dollars = dollars handed over (in cents)
 * Only one shift is open per clinic, held by a partial unique index, so two clicks at once open one.
 */

const ROLES = ['OWNER', 'RECEPTION', 'CASHIER'] as const;
const count = z.number().int().min(0).max(1_000_000_000);

async function expectedFor(ctx: ClContext, shiftId: string, openingIqd: number) {
  const rows = await ctx.db.clPayment.findMany({ where: { shiftId }, select: { currency: true, tendered: true, changeIqd: true } });
  let expectedIqd = openingIqd;
  let expectedUsd = 0;
  for (const row of rows) {
    if (row.currency === 'IQD') expectedIqd += row.tendered;
    else expectedUsd += row.tendered;
    expectedIqd -= row.changeIqd;
  }
  return { expectedIqd, expectedUsd, payments: rows.length };
}

const isUniqueViolation = (error: unknown) => /P2002|23505|ClShift_one_open/.test(`${(error as { code?: string })?.code ?? ''} ${(error as Error)?.message ?? ''}`);

export const currentShift = defineClAction({
  name: 'clinic.shifts.current',
  roles: [...ROLES],
  input: z.object({}),
  run: async (ctx) => {
    const shift = await ctx.db.clShift.findFirst({ where: { status: 'OPEN' } });
    if (!shift) return null;
    return { shiftId: shift.id, openedAt: shift.openedAt.toISOString(), openingIqd: shift.openingIqd, ...(await expectedFor(ctx, shift.id, shift.openingIqd)) };
  },
});

export const openShift = defineClAction({
  name: 'clinic.shifts.open',
  roles: [...ROLES],
  input: z.object({ openingIqd: count }),
  run: async (ctx, { openingIqd }) => {
    if (await ctx.db.clShift.findFirst({ where: { status: 'OPEN' }, select: { id: true } })) throw new StudioError('INVALID', 'A shift is already open');
    let shift;
    try {
      shift = await ctx.db.clShift.create({ data: { restaurantId: ctx.restaurantId, openedById: ctx.member.memberId, openingIqd } });
    } catch (error) {
      if (isUniqueViolation(error)) throw new StudioError('INVALID', 'A shift is already open');
      throw error;
    }
    ctx.audit({ action: 'clinic.shift_opened', entityType: 'ClShift', entityId: shift.id, changes: { openingIqd: { before: null, after: openingIqd } } });
    return { shiftId: shift.id };
  },
});

export const closeShift = defineClAction({
  name: 'clinic.shifts.close',
  roles: [...ROLES],
  input: z.object({ countedIqd: count, countedUsd: count }),
  run: async (ctx, { countedIqd, countedUsd }) => {
    const shift = await ctx.db.clShift.findFirst({ where: { status: 'OPEN' } });
    if (!shift) throw new StudioError('INVALID', 'There is no open shift');
    // Claim the close first, so a second close finds it closed; then write the figures.
    const { count: claimed } = await ctx.db.clShift.updateMany({ where: { id: shift.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date(), closedById: ctx.member.memberId } });
    if (claimed === 0) throw new StudioError('INVALID', 'This shift is already closed');
    const { expectedIqd, expectedUsd } = await expectedFor(ctx, shift.id, shift.openingIqd);
    await ctx.db.clShift.updateMany({ where: { id: shift.id }, data: { expectedIqd, expectedUsd, countedIqd, countedUsd } });
    const differenceIqd = countedIqd - expectedIqd;
    const differenceUsd = countedUsd - expectedUsd;
    ctx.audit({ action: 'clinic.shift_closed', entityType: 'ClShift', entityId: shift.id, changes: { differenceIqd: { before: 0, after: differenceIqd }, differenceUsd: { before: 0, after: differenceUsd } } });
    return { expectedIqd, expectedUsd, differenceIqd, differenceUsd };
  },
});

export const listShifts = defineClAction({
  name: 'clinic.shifts.list',
  roles: ['OWNER'],
  input: z.object({}),
  run: async (ctx) => {
    const rows = await ctx.db.clShift.findMany({ orderBy: { openedAt: 'desc' }, take: 30 });
    return rows.map((s) => ({
      shiftId: s.id,
      status: s.status,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      openingIqd: s.openingIqd,
      expectedIqd: s.expectedIqd,
      expectedUsd: s.expectedUsd,
      countedIqd: s.countedIqd,
      countedUsd: s.countedUsd,
    }));
  },
});
