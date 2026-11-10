import { z } from 'zod';
import { InsufficientStockError, InvalidStockError, NoStockToRecostError } from '@/server/domain/wholesale/costing';
import { InvalidCatalogError, ItemLockedError, UNITS } from '@/server/domain/wholesale/catalog';
import {
  AlreadyReversedError,
  CurrencyMismatchError,
  FutureDateError,
  InvalidEntryError,
  PeriodClosedError,
  PeriodStateError,
  ReversalError,
  UnbalancedEntryError,
  UnknownAccountError,
} from '@/server/domain/wholesale/ledger';
import {
  InvalidPurchaseError,
  LANDED_COST_KINDS,
  OverpaymentError,
  PAYMENT_MODES,
  PurchaseNotCancellableError,
  PurchaseStateError,
} from '@/server/domain/wholesale/purchase';
import { CURRENCIES, InvalidRateError, RateMissingError } from '@/server/domain/wholesale/rates';
import { addLandedCostTx, cancelPurchaseTx, paySupplierTx, postPurchaseTx } from '@/server/wholesale/posting/purchase';
import { postPurchaseReturnTx, PURCHASE_REFUNDS } from '@/server/wholesale/posting/purchaseReturn';
import { setRate } from '@/server/wholesale/rates';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Purchases of a wholesale company (Phase 3): buying inside or outside Iraq in any of the three currencies, the extra costs of a
 * foreign purchase, paying the supplier, cancelling and returning. Only the partners hold `purchase.manage`; a rep never sees cost.
 * Each action runs in ONE transaction, so a refusal leaves nothing written.
 */

const CONFLICTS = [InsufficientStockError, PurchaseNotCancellableError, PurchaseStateError, OverpaymentError, AlreadyReversedError, ItemLockedError];
const REFUSALS = [
  InvalidCatalogError,
  InvalidStockError,
  NoStockToRecostError,
  InvalidPurchaseError,
  InvalidRateError,
  RateMissingError,
  PeriodClosedError,
  PeriodStateError,
  FutureDateError,
  InvalidEntryError,
  UnbalancedEntryError,
  UnknownAccountError,
  CurrencyMismatchError,
  ReversalError,
];

/** Turns the services' expected refusals into the action's answer, with the service's own words. */
export async function refusingBooks<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // The most common slip: no rate for today. Say it in the person's language, not as the service's English.
    if (error instanceof RateMissingError) throw new StudioError('INVALID', 'The exchange rate for this day is missing');
    if (CONFLICTS.some((c) => error instanceof c)) throw new StudioError('CONFLICT', (error as Error).message);
    if (REFUSALS.some((c) => error instanceof c)) throw new StudioError('INVALID', (error as Error).message);
    throw error;
  }
}

const id = z.string().min(1).max(64);
const money = z.string().trim().min(1).max(40);
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const currency = z.enum(CURRENCIES);

export const setRateAction = defineAction({
  name: 'wh.rate.set',
  permission: null,
  wh: 'rate.set',
  input: whPlaceInput.extend({ date: day, currency: z.enum(['USD', 'IRT']), iqdPer: money }),
  target: whTargetOf,
  run: (ctx, { restaurantId, date, currency: c, iqdPer }) =>
    ctx.transaction(async (tx) => {
      await refusingBooks(() => setRate(tx, restaurantId, date, c, iqdPer));
      ctx.audit({ action: 'wh.rate.set', entityType: 'WhExchangeRate', entityId: `${date}:${c}`, changes: { iqdPer: { before: null, after: iqdPer } } });
      return { ok: true as const };
    }),
});

export const postPurchaseAction = defineAction({
  name: 'wh.purchase.post',
  permission: null,
  wh: 'purchase.manage',
  input: whPlaceInput.extend({
    supplierId: id,
    date: day,
    currency,
    paymentMode: z.enum(PAYMENT_MODES),
    dueDate: day.nullish(),
    warehouseId: id.nullish(),
    lines: z.array(z.object({ itemId: id, unit: z.enum(UNITS), qty: money, unitPrice: money, expiry: day.nullish() })).min(1).max(500),
    /** Extra costs of a foreign purchase, posted in the same step (shipping, customs...). */
    landedCosts: z
      .array(z.object({ kind: z.enum(LANDED_COST_KINDS), amount: money, currency, date: day.optional(), paymentMode: z.enum(PAYMENT_MODES).optional() }))
      .max(20)
      .optional(),
  }),
  target: whTargetOf,
  run: (ctx, { restaurantId, landedCosts, ...purchase }) =>
    ctx.transaction(async (tx) =>
      refusingBooks(async () => {
        const user = { id: ctx.wh!.userId };
        const made = await postPurchaseTx(tx, restaurantId, user, purchase);
        for (const c of landedCosts ?? []) await addLandedCostTx(tx, restaurantId, user, made.purchaseId, { ...c, date: c.date ?? purchase.date });
        ctx.audit({
          action: 'wh.purchase.post',
          entityType: 'WhPurchase',
          entityId: made.purchaseId,
          changes: { supplierId: { before: null, after: purchase.supplierId }, currency: { before: null, after: purchase.currency }, lines: { before: null, after: purchase.lines.length } },
        });
        return made;
      }),
    ),
});

export const addLandedCostAction = defineAction({
  name: 'wh.purchase.addLandedCost',
  permission: null,
  wh: 'purchase.manage',
  input: whPlaceInput.extend({
    purchaseId: id,
    kind: z.enum(LANDED_COST_KINDS),
    amount: money,
    currency,
    date: day,
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    supplierId: id.nullish(),
  }),
  target: whTargetOf,
  run: (ctx, { restaurantId, purchaseId, ...cost }) =>
    ctx.transaction(async (tx) =>
      refusingBooks(async () => {
        const made = await addLandedCostTx(tx, restaurantId, { id: ctx.wh!.userId }, purchaseId, cost);
        ctx.audit({ action: 'wh.purchase.landed_cost', entityType: 'WhPurchase', entityId: purchaseId, changes: { kind: { before: null, after: cost.kind }, amount: { before: null, after: cost.amount } } });
        return made;
      }),
    ),
});

export const paySupplierAction = defineAction({
  name: 'wh.supplier.pay',
  permission: null,
  wh: 'purchase.manage',
  input: whPlaceInput.extend({ supplierId: id, amount: money, currency, date: day, purchaseId: id.nullish() }),
  target: whTargetOf,
  run: (ctx, { restaurantId, ...payment }) =>
    ctx.transaction(async (tx) =>
      refusingBooks(async () => {
        const made = await paySupplierTx(tx, restaurantId, { id: ctx.wh!.userId }, payment);
        ctx.audit({ action: 'wh.supplier.pay', entityType: 'WhSupplier', entityId: payment.supplierId, changes: { amount: { before: null, after: payment.amount }, currency: { before: null, after: payment.currency } } });
        return made;
      }),
    ),
});

export const cancelPurchaseAction = defineAction({
  name: 'wh.purchase.cancel',
  permission: null,
  wh: 'purchase.manage',
  input: whPlaceInput.extend({ purchaseId: id, reason: z.string().trim().min(1).max(300) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, purchaseId, reason }) =>
    ctx.transaction(async (tx) =>
      refusingBooks(async () => {
        await cancelPurchaseTx(tx, restaurantId, { id: ctx.wh!.userId }, purchaseId, reason);
        ctx.audit({ action: 'wh.purchase.cancel', entityType: 'WhPurchase', entityId: purchaseId, changes: { status: { before: 'POSTED', after: 'CANCELLED' } } });
        return { ok: true as const };
      }),
    ),
});

export const returnPurchaseAction = defineAction({
  name: 'wh.purchase.return',
  permission: null,
  wh: 'purchase.manage',
  input: whPlaceInput.extend({
    purchaseId: id,
    refund: z.enum(PURCHASE_REFUNDS).nullish(),
    lines: z.array(z.object({ purchaseLineId: id, qty: money })).min(1).max(500),
  }),
  target: whTargetOf,
  run: (ctx, { restaurantId, ...input }) =>
    ctx.transaction(async (tx) =>
      refusingBooks(async () => {
        const made = await postPurchaseReturnTx(tx, restaurantId, { id: ctx.wh!.userId }, input);
        ctx.audit({ action: 'wh.purchase.return', entityType: 'WhPurchaseReturn', entityId: made.returnId, changes: { purchaseId: { before: null, after: input.purchaseId } } });
        return made;
      }),
    ),
});
