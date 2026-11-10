import { z } from 'zod';
import { ForbiddenError } from '@/server/domain/wholesale/permissions';
import { CURRENCIES, baghdadDate } from '@/server/domain/wholesale/rates';
import { InvalidAgencyError, cancelAgencyOrderTx, collectAgencyTx, createAgencyOrderTx, payCostTx, receiveAdvanceTx, settleAgencyOrderTx } from '@/server/wholesale/posting/agency';
import { refusingBooks } from '@/server/wholesale/actions/purchase';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/** Agency orders: the company handles an order for another company. Owner and partner only (the services check it too). */

async function refusing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await refusingBooks(fn);
  } catch (error) {
    if (error instanceof StudioError) throw error;
    if (error instanceof ForbiddenError) throw new StudioError('FORBIDDEN', error.message);
    if (error instanceof InvalidAgencyError) throw new StudioError('INVALID', error.message);
    throw error;
  }
}

const id = z.string().min(1).max(64);
const money = z.string().trim().min(1).max(40);
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const note = z.string().trim().max(500).nullish();
const userOf = (ctx: { wh: { userId: string; role: 'OWNER' | 'PARTNER' | 'REP' } | null }) => ({ id: ctx.wh!.userId, role: ctx.wh!.role });
const today = () => baghdadDate();

export const createAgencyOrderAction = defineAction({
  name: 'wh.agency.create',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ principalId: id, title: z.string().trim().min(1).max(200), note: z.string().trim().max(2000).nullish(), currency: z.enum(CURRENCIES), agreedTotal: money, date: day.optional() }),
  target: whTargetOf,
  run: (ctx, { restaurantId, date, ...order }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await createAgencyOrderTx(tx, restaurantId, userOf(ctx), { ...order, date: date ?? today() });
        ctx.audit({ action: 'wh.agency.create', entityType: 'WhAgencyOrder', entityId: made.orderId, changes: { title: { before: null, after: order.title } } });
        return made;
      }),
    ),
});

export const receiveAdvanceAction = defineAction({
  name: 'wh.agency.advance',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ orderId: id, amount: money, date: day.optional(), custodyRepId: id.nullish(), note }),
  target: whTargetOf,
  run: (ctx, { restaurantId, date, ...p }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await receiveAdvanceTx(tx, restaurantId, userOf(ctx), { ...p, date: date ?? today() });
        ctx.audit({ action: 'wh.agency.advance', entityType: 'WhAgencyOrder', entityId: p.orderId, changes: { amount: { before: null, after: p.amount } } });
        return made;
      }),
    ),
});

export const payAgencyCostAction = defineAction({
  name: 'wh.agency.cost',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ orderId: id, amount: money, date: day.optional(), note }),
  target: whTargetOf,
  run: (ctx, { restaurantId, date, ...p }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await payCostTx(tx, restaurantId, userOf(ctx), { ...p, date: date ?? today() });
        ctx.audit({ action: 'wh.agency.cost', entityType: 'WhAgencyOrder', entityId: p.orderId, changes: { amount: { before: null, after: p.amount } } });
        return made;
      }),
    ),
});

export const settleAgencyAction = defineAction({
  name: 'wh.agency.settle',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ orderId: id, commission: money, date: day.optional() }),
  target: whTargetOf,
  run: (ctx, { restaurantId, date, ...p }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await settleAgencyOrderTx(tx, restaurantId, userOf(ctx), { ...p, date: date ?? today() });
        ctx.audit({ action: 'wh.agency.settle', entityType: 'WhAgencyOrder', entityId: p.orderId, changes: { commission: { before: null, after: p.commission } } });
        return made;
      }),
    ),
});

export const collectAgencyAction = defineAction({
  name: 'wh.agency.collect',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ orderId: id, amount: money, date: day.optional(), custodyRepId: id.nullish(), note }),
  target: whTargetOf,
  run: (ctx, { restaurantId, date, ...p }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await collectAgencyTx(tx, restaurantId, userOf(ctx), { ...p, date: date ?? today() });
        ctx.audit({ action: 'wh.agency.collect', entityType: 'WhAgencyOrder', entityId: p.orderId, changes: { amount: { before: null, after: p.amount } } });
        return made;
      }),
    ),
});

export const cancelAgencyAction = defineAction({
  name: 'wh.agency.cancel',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ orderId: id }),
  target: whTargetOf,
  run: (ctx, { restaurantId, orderId }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await cancelAgencyOrderTx(tx, restaurantId, userOf(ctx), { orderId, date: today() });
        ctx.audit({ action: 'wh.agency.cancel', entityType: 'WhAgencyOrder', entityId: orderId, changes: { status: { before: 'OPEN', after: 'CANCELLED' } } });
        return made;
      }),
    ),
});
