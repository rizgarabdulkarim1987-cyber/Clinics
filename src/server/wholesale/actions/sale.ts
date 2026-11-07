import { z } from 'zod';
import { UNITS } from '@/server/domain/wholesale/catalog';
import { ForbiddenError } from '@/server/domain/wholesale/permissions';
import { PAYMENT_MODES } from '@/server/domain/wholesale/purchase';
import { CURRENCIES } from '@/server/domain/wholesale/rates';
import { CreditLimitExceededError, InvalidSaleError, PRICE_MODES, ReturnQtyExceededError, SaleStateError } from '@/server/domain/wholesale/sale';
import { InvalidCustodyError, InsufficientCustodyError, CustodyStateError } from '@/server/domain/wholesale/treasury';
import { REFUND_MODES, RETURN_CONDITIONS, postReturnTx } from '@/server/wholesale/posting/return';
import { approveSaleTx, cancelSaleTx, postSaleTx, receiveCustomerPaymentTx, rejectSaleTx } from '@/server/wholesale/posting/sale';
import { refusingBooks } from '@/server/wholesale/actions/purchase';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Selling in a wholesale company (Phase 4): the invoice with a discount in dinars, dollars or tomans, collecting from customers, a
 * rep's own sales from his own warehouse, cancelling, returns and exchange. A rep only sells from his own warehouse to his own
 * customers; the services enforce it on top of the permission, so a rep cannot name another warehouse or customer.
 */

/** Same as `refusingBooks`, plus the sale and custody refusals. */
async function refusing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await refusingBooks(fn);
  } catch (error) {
    if (error instanceof StudioError) throw error;
    if (error instanceof ForbiddenError) throw new StudioError('FORBIDDEN', error.message);
    if (error instanceof SaleStateError || error instanceof CreditLimitExceededError || error instanceof InsufficientCustodyError || error instanceof CustodyStateError)
      throw new StudioError('CONFLICT', (error as Error).message);
    if (error instanceof InvalidSaleError || error instanceof ReturnQtyExceededError || error instanceof InvalidCustodyError) throw new StudioError('INVALID', (error as Error).message);
    throw error;
  }
}

const id = z.string().min(1).max(64);
const money = z.string().trim().min(1).max(40);
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const currency = z.enum(CURRENCIES);

const saleLine = z.object({
  itemId: id,
  unit: z.enum(UNITS),
  qty: money,
  mode: z.enum(PRICE_MODES),
  percent: money.nullish(),
  manual: money.nullish(),
});

const userOf = (ctx: { wh: { userId: string; role: 'OWNER' | 'PARTNER' | 'REP' } | null }) => ({ id: ctx.wh!.userId, role: ctx.wh!.role });

export const postSaleAction = defineAction({
  name: 'wh.sale.post',
  permission: null,
  wh: 'sale.create',
  input: whPlaceInput.extend({
    customerId: id,
    date: day.optional(),
    currency,
    paymentMode: z.enum(PAYMENT_MODES),
    warehouseId: id,
    dueDate: day.nullish(),
    lines: z.array(saleLine).min(1).max(500),
  }),
  target: whTargetOf,
  run: (ctx, { restaurantId, date, ...sale }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await postSaleTx(tx, restaurantId, userOf(ctx), { ...sale, date: date ?? '' });
        ctx.audit({
          action: 'wh.sale.post',
          entityType: 'WhSale',
          entityId: made.saleId,
          changes: { customerId: { before: null, after: sale.customerId }, currency: { before: null, after: sale.currency }, status: { before: null, after: made.status } },
        });
        return made;
      }),
    ),
});

export const approveSaleAction = defineAction({
  name: 'wh.sale.approve',
  permission: null,
  wh: 'sale.override',
  input: whPlaceInput.extend({ saleId: id }),
  target: whTargetOf,
  run: (ctx, { restaurantId, saleId }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await approveSaleTx(tx, restaurantId, userOf(ctx), saleId);
        ctx.audit({ action: 'wh.sale.approve', entityType: 'WhSale', entityId: saleId, changes: { status: { before: 'PENDING_APPROVAL', after: 'POSTED' } } });
        return made;
      }),
    ),
});

export const rejectSaleAction = defineAction({
  name: 'wh.sale.reject',
  permission: null,
  wh: 'sale.override',
  input: whPlaceInput.extend({ saleId: id, reason: z.string().trim().min(1).max(300) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, saleId, reason }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        await rejectSaleTx(tx, restaurantId, userOf(ctx), saleId, reason);
        ctx.audit({ action: 'wh.sale.reject', entityType: 'WhSale', entityId: saleId, changes: { status: { before: 'PENDING_APPROVAL', after: 'REJECTED' } } });
        return { ok: true as const };
      }),
    ),
});

export const cancelSaleAction = defineAction({
  name: 'wh.sale.cancel',
  permission: null,
  wh: 'sale.override',
  input: whPlaceInput.extend({ saleId: id, reason: z.string().trim().min(1).max(300) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, saleId, reason }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        await cancelSaleTx(tx, restaurantId, userOf(ctx), saleId, reason);
        ctx.audit({ action: 'wh.sale.cancel', entityType: 'WhSale', entityId: saleId, changes: { status: { before: 'POSTED', after: 'CANCELLED' } } });
        return { ok: true as const };
      }),
    ),
});

export const collectPaymentAction = defineAction({
  name: 'wh.customer.pay',
  permission: null,
  wh: 'payment.collect',
  input: whPlaceInput.extend({ customerId: id, amount: money, currency, date: day.optional(), saleId: id.nullish() }),
  target: whTargetOf,
  run: (ctx, { restaurantId, date, ...payment }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await receiveCustomerPaymentTx(tx, restaurantId, userOf(ctx), { ...payment, date: date ?? '' });
        ctx.audit({ action: 'wh.customer.pay', entityType: 'WhCustomer', entityId: payment.customerId, changes: { amount: { before: null, after: payment.amount }, currency: { before: null, after: payment.currency } } });
        return made;
      }),
    ),
});

export const returnSaleAction = defineAction({
  name: 'wh.sale.return',
  permission: null,
  wh: 'sale.return',
  input: whPlaceInput.extend({
    saleId: id,
    refund: z.enum(REFUND_MODES),
    lines: z.array(z.object({ saleLineId: id, qty: money, condition: z.enum(RETURN_CONDITIONS) })).min(1).max(500),
    exchange: z.object({ lines: z.array(saleLine).min(1).max(500) }).nullish(),
    date: day.nullish(),
  }),
  target: whTargetOf,
  run: (ctx, { restaurantId, ...input }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await postReturnTx(tx, restaurantId, userOf(ctx), input);
        ctx.audit({ action: 'wh.sale.return', entityType: 'WhSaleReturn', entityId: made.returnId, changes: { saleId: { before: null, after: input.saleId } } });
        return { returnId: made.returnId, exchangeSaleId: made.exchangeSaleId ?? null, settlement: { direction: made.settlement.direction, amount: made.settlement.amount.toFixed(), currency: made.settlement.currency } };
      }),
    ),
});
