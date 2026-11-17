import { isUniqueViolation } from './db-errors';
import type { ClContext } from './framework';

/**
 * The stamp ledger. A household's balance is the sum of its entries; an entry's `refKey` is unique per clinic, so one
 * bill stamps once and one referral pays once, whatever clicks twice.
 */

type Kind = 'VISIT' | 'REFERRAL' | 'REDEEM';

/** Writes an entry; false when its `refKey` already exists. */
export async function addEntry(ctx: ClContext, entry: { householdId: string; kind: Kind; delta: number; refKey: string }): Promise<boolean> {
  try {
    await ctx.db.clLoyaltyEntry.create({ data: { restaurantId: ctx.restaurantId, ...entry } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

export async function balanceOf(ctx: ClContext, householdId: string): Promise<number> {
  return (await ctx.db.clLoyaltyEntry.aggregate({ where: { householdId }, _sum: { delta: true } }))._sum.delta ?? 0;
}

/**
 * A bill that has just been fully paid earns its household one stamp, and, the first time, the referrer's household
 * the referral bonus. Nothing is earned while loyalty is off or for a bill with nothing to pay.
 */
export async function earnForBill(ctx: ClContext, bill: { id: string; patientId: string; total: number }): Promise<void> {
  const settings = await ctx.db.clSettings.findFirst({});
  if (!settings?.loyaltyEnabled || bill.total <= 0) return;
  const patient = await ctx.db.clPatient.findFirst({ where: { id: bill.patientId } });
  if (!patient) return;
  if (!(await addEntry(ctx, { householdId: patient.householdId, kind: 'VISIT', delta: 1, refKey: `visit:${bill.id}` }))) return;
  if (!patient.referredById || settings.referralStamps <= 0) return;
  const referrer = await ctx.db.clPatient.findFirst({ where: { id: patient.referredById } });
  if (referrer && referrer.householdId !== patient.householdId) {
    await addEntry(ctx, { householdId: referrer.householdId, kind: 'REFERRAL', delta: settings.referralStamps, refKey: `referral:${patient.id}` });
  }
}
