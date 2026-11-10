import { z } from 'zod';
import { ForbiddenError } from '@/server/domain/wholesale/permissions';
import { CURRENCIES } from '@/server/domain/wholesale/rates';
import { EXPENSE_CATEGORIES, CustodyStateError, ExpenseStateError, InsufficientCustodyError, InvalidConversionError, InvalidCustodyError, InvalidExpenseError } from '@/server/domain/wholesale/treasury';
import { convertCashTx } from '@/server/wholesale/posting/conversion';
import { confirmHandoverTx, receiveFromRepTx, rejectHandoverTx, submitHandoverTx } from '@/server/wholesale/posting/custody';
import { approveExpenseTx, postExpenseTx, rejectExpenseTx } from '@/server/wholesale/posting/expense';
import { refusingBooks } from '@/server/wholesale/actions/purchase';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The treasury (Phase 5): converting cash between the currency boxes, a rep handing his custody to the office, and expenses
 * (a partner posts at once; a rep's wait for a partner's approval and are paid from his custody).
 */

async function refusing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await refusingBooks(fn);
  } catch (error) {
    if (error instanceof StudioError) throw error;
    if (error instanceof ForbiddenError) throw new StudioError('FORBIDDEN', error.message);
    if (error instanceof CustodyStateError || error instanceof InsufficientCustodyError || error instanceof ExpenseStateError) throw new StudioError('CONFLICT', (error as Error).message);
    if (error instanceof InvalidConversionError || error instanceof InvalidCustodyError || error instanceof InvalidExpenseError) throw new StudioError('INVALID', (error as Error).message);
    throw error;
  }
}

const id = z.string().min(1).max(64);
const money = z.string().trim().min(1).max(40);
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const currency = z.enum(CURRENCIES);
const amounts = z.array(z.object({ amount: money, currency })).min(1).max(3);

const userOf = (ctx: { wh: { userId: string; role: 'OWNER' | 'PARTNER' | 'REP' } | null }) => ({ id: ctx.wh!.userId, role: ctx.wh!.role });

export const convertCashAction = defineAction({
  name: 'wh.treasury.convert',
  permission: null,
  wh: 'treasury.manage',
  input: whPlaceInput.extend({ amount: money, from: currency, to: currency, date: day }),
  target: whTargetOf,
  run: (ctx, { restaurantId, amount, from, to, date }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await convertCashTx(tx, restaurantId, userOf(ctx), { from: { amount, currency: from }, toCurrency: to, date });
        ctx.audit({ action: 'wh.treasury.convert', entityType: 'WhCurrencyConversion', entityId: made.conversionId, changes: { from: { before: null, after: `${amount} ${from}` }, to: { before: null, after: `${made.toAmount.toFixed()} ${to}` } } });
        return { conversionId: made.conversionId, toAmount: made.toAmount.toFixed() };
      }),
    ),
});

export const submitHandoverAction = defineAction({
  name: 'wh.handover.submit',
  permission: null,
  wh: 'custody.submit',
  input: whPlaceInput.extend({ amounts }),
  target: whTargetOf,
  run: (ctx, { restaurantId, amounts: list }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await submitHandoverTx(tx, restaurantId, userOf(ctx), { amounts: list });
        ctx.audit({ action: 'wh.handover.submit', entityType: 'WhCustodyHandover', entityId: made.handoverId, changes: {} });
        return made;
      }),
    ),
});

export const confirmHandoverAction = defineAction({
  name: 'wh.handover.confirm',
  permission: null,
  wh: 'custody.confirm',
  input: whPlaceInput.extend({ handoverId: id, received: z.array(z.object({ amount: z.string().trim().max(40), currency })).min(1).max(3) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, handoverId, received }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await confirmHandoverTx(tx, restaurantId, userOf(ctx), handoverId, received);
        ctx.audit({ action: 'wh.handover.confirm', entityType: 'WhCustodyHandover', entityId: handoverId, changes: { status: { before: 'PENDING', after: made.status } } });
        return { status: made.status };
      }),
    ),
});

export const rejectHandoverAction = defineAction({
  name: 'wh.handover.reject',
  permission: null,
  wh: 'custody.confirm',
  input: whPlaceInput.extend({ handoverId: id, reason: z.string().trim().min(1).max(500) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, handoverId, reason }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        await rejectHandoverTx(tx, restaurantId, userOf(ctx), handoverId, reason);
        ctx.audit({ action: 'wh.handover.reject', entityType: 'WhCustodyHandover', entityId: handoverId, changes: { status: { before: 'PENDING', after: 'REJECTED' } } });
        return { ok: true as const };
      }),
    ),
});

export const postExpenseAction = defineAction({
  name: 'wh.expense.post',
  permission: null,
  wh: 'expense.submit',
  input: whPlaceInput.extend({ category: z.enum(EXPENSE_CATEGORIES), amount: money, currency, date: day.optional(), warehouseId: id.nullish(), note: z.string().trim().max(500).nullish() }),
  target: whTargetOf,
  run: (ctx, { restaurantId, category, amount, currency: cur, date, warehouseId, note }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await postExpenseTx(tx, restaurantId, userOf(ctx), { category, amount: { amount, currency: cur }, date: date ?? '', warehouseId, note });
        ctx.audit({ action: 'wh.expense.post', entityType: 'WhExpense', entityId: made.expenseId, changes: { category: { before: null, after: category }, status: { before: null, after: made.status } } });
        return made;
      }),
    ),
});

export const approveExpenseAction = defineAction({
  name: 'wh.expense.approve',
  permission: null,
  wh: 'expense.manage',
  input: whPlaceInput.extend({ expenseId: id }),
  target: whTargetOf,
  run: (ctx, { restaurantId, expenseId }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        await approveExpenseTx(tx, restaurantId, userOf(ctx), expenseId);
        ctx.audit({ action: 'wh.expense.approve', entityType: 'WhExpense', entityId: expenseId, changes: { status: { before: 'PENDING', after: 'POSTED' } } });
        return { ok: true as const };
      }),
    ),
});

export const rejectExpenseAction = defineAction({
  name: 'wh.expense.reject',
  permission: null,
  wh: 'expense.manage',
  input: whPlaceInput.extend({ expenseId: id, reason: z.string().trim().min(1).max(500) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, expenseId, reason }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        await rejectExpenseTx(tx, restaurantId, userOf(ctx), expenseId, reason);
        ctx.audit({ action: 'wh.expense.reject', entityType: 'WhExpense', entityId: expenseId, changes: { status: { before: 'PENDING', after: 'REJECTED' } } });
        return { ok: true as const };
      }),
    ),
});

export const receiveFromRepAction = defineAction({
  name: 'wh.custody.receive',
  permission: null,
  wh: 'custody.confirm',
  input: whPlaceInput.extend({ repId: id, amounts }),
  target: whTargetOf,
  run: (ctx, { restaurantId, repId, amounts: list }) =>
    ctx.transaction(async (tx) =>
      refusing(async () => {
        const made = await receiveFromRepTx(tx, restaurantId, userOf(ctx), { repId, amounts: list });
        ctx.audit({ action: 'wh.custody.receive', entityType: 'WhStaff', entityId: repId, changes: { received: { before: null, after: list.map((a) => `${a.amount} ${a.currency}`).join(', ') } } });
        return made;
      }),
    ),
});
