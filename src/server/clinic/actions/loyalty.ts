import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction, type ClContext } from '../framework';
import { addEntry, balanceOf, earnForBill } from '../loyalty';

/**
 * Loyalty at the clinic: the owner's switch and numbers, a household's card, and spending a full card on an open bill as
 * a negative line. The card is the household's, not one patient's. No clinical text is read.
 */

const STAFF = ['OWNER', 'RECEPTION', 'CASHIER'] as const;
const idField = z.string().min(1).max(64);
const REWARD_LABEL = 'Loyalty reward';

const settingsRow = (ctx: ClContext) => ctx.db.clSettings.findFirst({});

export const getLoyaltySettings = defineClAction({
  name: 'clinic.loyalty.getSettings',
  roles: ['OWNER'],
  input: z.object({}),
  run: async (ctx) => {
    const s = await settingsRow(ctx);
    return { enabled: s?.loyaltyEnabled ?? false, every: s?.loyaltyEvery ?? 5, rewardIqd: s?.loyaltyRewardIqd ?? 5000, referralStamps: s?.referralStamps ?? 1 };
  },
});

export const saveLoyaltySettings = defineClAction({
  name: 'clinic.loyalty.saveSettings',
  roles: ['OWNER'],
  input: z.object({ enabled: z.boolean(), every: z.number().int().min(1).max(100), rewardIqd: z.number().int().min(0).max(1_000_000_000), referralStamps: z.number().int().min(0).max(10) }),
  run: async (ctx, { enabled, every, rewardIqd, referralStamps }) => {
    const row = await ctx.db.clSettings.findFirst({});
    const data = { loyaltyEnabled: enabled, loyaltyEvery: every, loyaltyRewardIqd: rewardIqd, referralStamps };
    if (row) await ctx.db.clSettings.updateMany({ where: { id: row.id }, data });
    else await ctx.db.clSettings.create({ data: { restaurantId: ctx.restaurantId, ...data } });
    ctx.audit({ action: 'clinic.loyalty_saved', entityType: 'ClSettings', entityId: row?.id ?? ctx.restaurantId, changes: { enabled: { before: row?.loyaltyEnabled ?? false, after: enabled } } });
    return null;
  },
});

export const getHouseholdCard = defineClAction({
  name: 'clinic.loyalty.card',
  roles: [...STAFF],
  input: z.object({ patientId: idField }),
  run: async (ctx, { patientId }) => {
    const patient = await ctx.db.clPatient.findFirst({ where: { id: patientId } });
    if (!patient) throw new StudioError('NOT_FOUND');
    const s = await settingsRow(ctx);
    const enabled = s?.loyaltyEnabled ?? false;
    const every = s?.loyaltyEvery ?? 5;
    const stamps = await balanceOf(ctx, patient.householdId);
    return { enabled, stamps, every, rewardIqd: s?.loyaltyRewardIqd ?? 5000, canRedeem: enabled && stamps >= every };
  },
});

export const redeemReward = defineClAction({
  name: 'clinic.loyalty.redeem',
  roles: [...STAFF],
  input: z.object({ billId: idField }),
  run: async (ctx, { billId }) => {
    const s = await settingsRow(ctx);
    if (!s?.loyaltyEnabled) throw new StudioError('INVALID', 'Loyalty is switched off');
    const bill = await ctx.db.clBill.findFirst({ where: { id: billId } });
    if (!bill) throw new StudioError('NOT_FOUND');
    if (bill.status !== 'OPEN') throw new StudioError('INVALID', 'This bill is not open');
    const patient = await ctx.db.clPatient.findFirst({ where: { id: bill.patientId } });
    if (!patient) throw new StudioError('NOT_FOUND');
    const discount = Math.min(s.loyaltyRewardIqd, bill.total - bill.paid);
    if (discount <= 0) throw new StudioError('INVALID', 'There is nothing to take off');
    if ((await balanceOf(ctx, patient.householdId)) < s.loyaltyEvery) throw new StudioError('INVALID', 'The card is not full yet');
    const refKey = `redeem:${billId}`;
    if (!(await addEntry(ctx, { householdId: patient.householdId, kind: 'REDEEM', delta: -s.loyaltyEvery, refKey }))) throw new StudioError('INVALID', 'This bill already has a reward');
    // Two spends at once: if the balance went below zero, this one lost and takes its entry back.
    const undo = () => ctx.db.clLoyaltyEntry.deleteMany({ where: { refKey } });
    if ((await balanceOf(ctx, patient.householdId)) < 0) {
      await undo();
      throw new StudioError('INVALID', 'The card is not full yet');
    }
    const settled = bill.total - discount <= bill.paid;
    const { count } = await ctx.db.clBill.updateMany({
      where: { id: billId, status: 'OPEN', version: bill.version },
      data: { total: { decrement: discount }, version: { increment: 1 }, ...(settled ? { status: 'PAID' as const, closedAt: new Date() } : {}) },
    });
    if (count === 0) {
      await undo();
      throw new StudioError('INVALID', 'This bill changed, check it and try again');
    }
    await ctx.db.clBillLine.create({ data: { restaurantId: ctx.restaurantId, billId, label: REWARD_LABEL, amount: -discount, sortOrder: 200 } });
    if (settled) {
      await ctx.db.clTicket.updateMany({ where: { id: bill.ticketId, status: 'TO_PAY' }, data: { status: 'DONE' } });
      await earnForBill(ctx, { id: bill.id, patientId: bill.patientId, total: bill.total - discount });
    }
    ctx.audit({ action: 'clinic.loyalty_redeemed', entityType: 'ClBill', entityId: billId, changes: { total: { before: bill.total, after: bill.total - discount } } });
    return { discount, settled };
  },
});
