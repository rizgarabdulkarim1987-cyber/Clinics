import { z } from 'zod';
import { InsufficientStockError, InvalidStockError, NoStockToRecostError } from '@/server/domain/wholesale/costing';
import { InvalidCatalogError, ItemLockedError, UNITS } from '@/server/domain/wholesale/catalog';
import { canWh, WH_ROLES } from '@/server/domain/wholesale/permissions';
import {
  createCustomer,
  createItem,
  createSupplier,
  deleteItem,
  seedCities,
  setItemActive,
  setItemPrices,
  updateCustomer,
  updateItem,
  updateSupplier,
} from '@/server/wholesale/catalog';
import { openItemStock } from '@/server/wholesale/openingItem';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import { createRepWarehouse, seedWarehouses, transferMainToRep } from '@/server/wholesale/warehouses';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The catalog, customers, suppliers, warehouses and staff of a wholesale company (Phase 2). Every definition names the company
 * (`restaurantId`) it works in; the framework resolves the person's role there and refuses anyone who has none. A rep holds
 * none of the permissions used here: he sells and sees his own warehouse, nothing else.
 */

export const whPlaceInput = z.object({ restaurantId: z.string().min(1).max(64) });
export const whTargetOf = (input: { restaurantId: string }) => ({ kind: 'wh', restaurantId: input.restaurantId }) as const;

/** Turns the services' expected refusals into the action's answer, with the service's own words. */
export async function refusing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof InvalidCatalogError ||
      error instanceof ItemLockedError ||
      error instanceof InvalidStockError ||
      error instanceof InsufficientStockError ||
      error instanceof NoStockToRecostError
    ) {
      throw new StudioError(error instanceof InsufficientStockError ? 'CONFLICT' : 'INVALID', error.message);
    }
    throw error;
  }
}

const text = (max: number) => z.string().trim().max(max);
const unitSchema = z.enum(UNITS);
const decimalText = z.string().trim().max(40);

const itemShape = z.object({
  code: text(60),
  names: z.object({ ckb: text(120).optional(), ar: text(120).optional(), en: text(120).optional() }),
  category: text(80).nullish(),
  baseUnit: unitSchema,
  units: z.array(z.object({ unit: unitSchema, factorToBase: decimalText, barcode: text(60).nullish() })).max(3),
  reorderPoint: decimalText.nullish(),
  active: z.boolean().optional(),
});

export const createItemAction = defineAction({
  name: 'wh.item.create',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ item: itemShape }),
  target: whTargetOf,
  run: (ctx, { restaurantId, item }) =>
    ctx.transaction(async (tx) => {
      const made = await refusing(() => createItem(tx, restaurantId, item));
      ctx.audit({ action: 'wh.item.create', entityType: 'WhItem', entityId: made.id, changes: { code: { before: null, after: made.code } } });
      return made;
    }),
});

export const updateItemAction = defineAction({
  name: 'wh.item.update',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ itemId: z.string().min(1).max(64), item: itemShape }),
  target: whTargetOf,
  run: (ctx, { restaurantId, itemId, item }) =>
    ctx.transaction(async (tx) => {
      const { previous, next } = await refusing(() => updateItem(tx, restaurantId, itemId, item));
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      for (const key of Object.keys(next)) if (previous[key] !== next[key]) changes[key] = { before: previous[key], after: next[key] };
      ctx.audit({ action: 'wh.item.update', entityType: 'WhItem', entityId: itemId, changes });
      return { id: itemId };
    }),
});

export const setItemActiveAction = defineAction({
  name: 'wh.item.setActive',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ itemId: z.string().min(1).max(64), active: z.boolean() }),
  target: whTargetOf,
  run: (ctx, { restaurantId, itemId, active }) =>
    ctx.transaction(async (tx) => {
      const done = await refusing(() => setItemActive(tx, restaurantId, itemId, active));
      ctx.audit({ action: 'wh.item.set_active', entityType: 'WhItem', entityId: itemId, changes: { active: { before: done.before, after: active } } });
      return { id: itemId };
    }),
});

export const deleteItemAction = defineAction({
  name: 'wh.item.delete',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ itemId: z.string().min(1).max(64) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, itemId }) =>
    ctx.transaction(async (tx) => {
      const gone = await refusing(() => deleteItem(tx, restaurantId, itemId));
      ctx.audit({ action: 'wh.item.delete', entityType: 'WhItem', entityId: itemId, changes: { code: { before: gone.code, after: null } } });
      return { id: itemId };
    }),
});

export const openItemStockAction = defineAction({
  name: 'wh.item.openStock',
  permission: null,
  wh: 'import.apply',
  input: whPlaceInput.extend({ itemId: z.string().min(1).max(64), qtyBase: decimalText, unitCostIqd: decimalText.nullish() }),
  target: whTargetOf,
  run: (ctx, { restaurantId, itemId, qtyBase, unitCostIqd }) =>
    ctx.transaction(async (tx) => {
      const done = await refusing(() => openItemStock(tx, restaurantId, { id: ctx.wh!.userId, role: ctx.wh!.role }, { itemId, qtyBase, unitCostIqd }));
      ctx.audit({ action: 'wh.item.open_stock', entityType: 'WhItem', entityId: itemId, changes: { openingQty: { before: null, after: done.qtyBase }, unitCost: { before: null, after: done.unitCostIqd } } });
      return done;
    }),
});

export const setPricesAction =defineAction({
  name: 'wh.item.setPrices',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ itemId: z.string().min(1).max(64), prices: z.array(z.object({ unit: unitSchema, priceIqd: decimalText, marketPriceIqd: decimalText.nullish() })).max(3) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, itemId, prices }) =>
    ctx.transaction(async (tx) => {
      const done = await refusing(() => setItemPrices(tx, restaurantId, itemId, prices));
      ctx.audit({
        action: 'wh.item.set_prices',
        entityType: 'WhItem',
        entityId: itemId,
        changes: Object.fromEntries(done.map((p) => [`price.${p.unit}`, { before: null, after: p.priceIqd }])),
      });
      return { prices: done };
    }),
});

const customerShape = z.object({
  name: text(120),
  phone: text(40).nullish(),
  cityId: z.string().min(1).max(64),
  repId: z.string().max(64).nullish(),
  creditLimitIqd: decimalText.nullish(),
  type: z.enum(['WHOLESALE', 'MARKET']).optional(),
  ownerName: text(120).nullish(),
  address: text(300).nullish(),
  active: z.boolean().optional(),
});

export const saveCustomerAction = defineAction({
  name: 'wh.customer.save',
  permission: null,
  wh: 'customer.create',
  input: whPlaceInput.extend({ customerId: z.string().min(1).max(64).optional(), customer: customerShape }),
  target: whTargetOf,
  run: (ctx, { restaurantId, customerId, customer: given }) =>
    ctx.transaction(async (tx) => {
      const manager = canWh(ctx.wh!.role, 'catalog.manage');
      // A rep only adds shops, always his own, with no credit limit of his choosing; changing one is for the partners.
      if (!manager && customerId) throw new StudioError('FORBIDDEN', 'Only a partner changes a customer');
      const customer = manager ? given : { ...given, repId: ctx.wh!.userId, creditLimitIqd: null, active: undefined };
      if (customerId) {
        await refusing(() => updateCustomer(tx, restaurantId, customerId, customer));
        ctx.audit({ action: 'wh.customer.update', entityType: 'WhCustomer', entityId: customerId, changes: { name: { before: null, after: customer.name } } });
        return { id: customerId };
      }
      const made = await refusing(() => createCustomer(tx, restaurantId, customer));
      ctx.audit({ action: 'wh.customer.create', entityType: 'WhCustomer', entityId: made.id, changes: { name: { before: null, after: customer.name } } });
      return made;
    }),
});

const supplierShape = z.object({ name: text(120), phone: text(40).nullish(), country: text(80).nullish(), isForeign: z.boolean(), active: z.boolean().optional() });

export const saveSupplierAction = defineAction({
  name: 'wh.supplier.save',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput.extend({ supplierId: z.string().min(1).max(64).optional(), supplier: supplierShape }),
  target: whTargetOf,
  run: (ctx, { restaurantId, supplierId, supplier }) =>
    ctx.transaction(async (tx) => {
      if (supplierId) {
        await refusing(() => updateSupplier(tx, restaurantId, supplierId, supplier));
        ctx.audit({ action: 'wh.supplier.update', entityType: 'WhSupplier', entityId: supplierId, changes: { name: { before: null, after: supplier.name } } });
        return { id: supplierId };
      }
      const made = await refusing(() => createSupplier(tx, restaurantId, supplier));
      ctx.audit({ action: 'wh.supplier.create', entityType: 'WhSupplier', entityId: made.id, changes: { name: { before: null, after: supplier.name } } });
      return made;
    }),
});

export const createRepWarehouseAction = defineAction({
  name: 'wh.warehouse.createRep',
  permission: null,
  wh: 'staff.manage',
  input: whPlaceInput.extend({ repUserId: z.string().min(1).max(64) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, repUserId }) =>
    ctx.transaction(async (tx) => {
      const made = await refusing(() => createRepWarehouse(tx, restaurantId, repUserId));
      ctx.audit({ action: 'wh.warehouse.create_rep', entityType: 'WhWarehouse', entityId: made.id, changes: { repUserId: { before: null, after: repUserId } } });
      return made;
    }),
});

export const transferToRepAction = defineAction({
  name: 'wh.stock.transferToRep',
  permission: null,
  wh: 'stock.transfer',
  input: whPlaceInput.extend({ itemId: z.string().min(1).max(64), toWarehouseId: z.string().min(1).max(64), qtyBase: decimalText }),
  target: whTargetOf,
  run: (ctx, { restaurantId, itemId, toWarehouseId, qtyBase }) =>
    ctx.transaction(async (tx) => {
      const made = await refusing(() => transferMainToRep(tx, restaurantId, ctx.actor.userId, { itemId, toWarehouseId, qtyBase }));
      ctx.audit({
        action: 'wh.stock.transfer',
        entityType: 'WhItem',
        entityId: itemId,
        changes: { toWarehouseId: { before: null, after: toWarehouseId }, qtyBase: { before: null, after: qtyBase } },
      });
      return made;
    }),
});

/** Gives a person who already has a Studio account a role in the company. Accounts themselves are made by the platform alone. */
export const setStaffAction = defineAction({
  name: 'wh.staff.set',
  permission: null,
  wh: 'staff.manage',
  input: whPlaceInput.extend({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(WH_ROLES).exclude(['OWNER']) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, email, role }) =>
    ctx.transaction(async (tx) => {
      const user = await ctx.db.user.findUnique({ where: { email }, select: { id: true, deactivatedAt: true } });
      if (!user || user.deactivatedAt) throw new StudioError('INVALID', 'Check the highlighted fields', { email: 'No active account has this email' });
      const existing = await tx.whStaff.findFirst({ where: { restaurantId, userId: user.id }, select: { id: true, role: true, deactivatedAt: true, warehouseId: true } });
      if (existing && existing.role === 'REP' && role !== 'REP' && existing.warehouseId) {
        throw new StudioError('CONFLICT', 'This rep owns a warehouse; it stays with him');
      }
      if (existing) {
        await tx.whStaff.update({ where: { id: existing.id }, data: { role, deactivatedAt: null } });
      } else {
        await tx.whStaff.create({ data: { restaurantId, userId: user.id, role } });
      }
      ctx.audit({ action: 'wh.staff.set', entityType: 'WhStaff', entityId: user.id, changes: { role: { before: existing?.role ?? null, after: role } } });
      return { userId: user.id };
    }),
});

export const deactivateStaffAction = defineAction({
  name: 'wh.staff.deactivate',
  permission: null,
  wh: 'staff.manage',
  input: whPlaceInput.extend({ userId: z.string().min(1).max(64) }),
  target: whTargetOf,
  run: (ctx, { restaurantId, userId }) =>
    ctx.transaction(async (tx) => {
      const row = await tx.whStaff.findFirst({ where: { restaurantId, userId, deactivatedAt: null }, select: { id: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      await tx.whStaff.update({ where: { id: row.id }, data: { deactivatedAt: new Date() } });
      ctx.audit({ action: 'wh.staff.deactivate', entityType: 'WhStaff', entityId: userId, changes: { active: { before: true, after: false } } });
      return { userId };
    }),
});

/** Makes the company's fixed rows (main and damage warehouses, cities) if missing. Idempotent; the first screen calls it. */
export const provisionAction = defineAction({
  name: 'wh.provision',
  permission: null,
  wh: 'settings.manage',
  input: whPlaceInput,
  target: whTargetOf,
  run: (ctx, { restaurantId }) =>
    ctx.transaction(async (tx) => {
      await seedWarehouses(tx, restaurantId);
      await seedCities(tx, restaurantId);
      await seedChartOfAccounts(tx, restaurantId);
      return { ok: true as const };
    }),
});
