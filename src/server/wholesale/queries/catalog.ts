import { canWh, whPermissionsOf } from '@/server/domain/wholesale/permissions';
import { listCustomers, listItems, listSuppliers } from '@/server/wholesale/catalog';
import { listWarehouses, stockFor } from '@/server/wholesale/warehouses';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { defineQuery } from '@/server/studio/framework/query';
import { z } from 'zod';

/**
 * Reads of a wholesale company (Phase 2). What a person may see is part of the query: a rep's lists hold his own customers and
 * his own warehouse only, and no cost column is ever selected for him.
 */

function actorOf(ctx: { wh: import('@/server/wholesale/actor').WhActor | null; scoped: import('@/server/data/tenant-db').ScopedClient | null }) {
  if (!ctx.wh || !ctx.scoped) throw new Error('A wholesale query ran without a wholesale actor');
  return { wh: ctx.wh, scoped: ctx.scoped };
}

/** Who the signed-in person is in this company, and what the screens may offer them. */
export const meQuery = defineQuery({
  name: 'wh.me',
  permission: null,
  wh: 'catalog.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { wh } = actorOf(ctx);
    return {
      userId: wh.userId,
      name: wh.name,
      company: wh.restaurantName,
      role: wh.role,
      warehouseId: wh.warehouseId,
      permissions: [...whPermissionsOf(wh.role)],
      locale: wh.locale,
    };
  },
});

export const itemsQuery = defineQuery({
  name: 'wh.items',
  permission: null,
  wh: 'catalog.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { wh, scoped } = actorOf(ctx);
    const items = await listItems(scoped, wh.restaurantId);
    const showCost = canWh(wh.role, 'cost.view');
    return items.map((i) => ({
      id: i.id,
      code: i.code,
      names: i.names as { ckb: string; ar: string; en: string },
      category: i.category,
      baseUnit: i.baseUnit,
      active: i.active,
      reorderPoint: showCost ? (i.reorderPoint?.toFixed() ?? null) : null,
      units: i.units.map((u) => ({ unit: u.unit, factorToBase: u.factorToBase.toFixed(), barcode: u.barcode })),
      prices: i.prices.map((p) => ({ unit: p.unit, priceIqd: p.priceIqd.toFixed() })),
    }));
  },
});

export const customersQuery = defineQuery({
  name: 'wh.customers',
  permission: null,
  wh: 'catalog.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { wh, scoped } = actorOf(ctx);
    const rows = await listCustomers(scoped, wh.restaurantId, { role: wh.role, userId: wh.userId });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      cityId: c.cityId,
      city: c.city.name as { ckb: string; ar: string; en: string },
      repId: c.repId,
      creditLimitIqd: c.creditLimitIqd?.toFixed() ?? null,
      active: c.active,
    }));
  },
});

/** Suppliers are never shown to a rep: a rep holds no `catalog.manage`, and the query refuses him. */
export const suppliersQuery = defineQuery({
  name: 'wh.suppliers',
  permission: null,
  wh: 'catalog.manage',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { wh, scoped } = actorOf(ctx);
    const rows = await listSuppliers(scoped, wh.restaurantId);
    return rows.map((s) => ({ id: s.id, name: s.name, phone: s.phone, country: s.country, isForeign: s.isForeign, active: s.active }));
  },
});

export const warehousesQuery = defineQuery({
  name: 'wh.warehouses',
  permission: null,
  wh: 'stock.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { wh, scoped } = actorOf(ctx);
    return listWarehouses(scoped, wh.restaurantId, { role: wh.role, warehouseId: wh.warehouseId });
  },
});

export const cityListQuery = defineQuery({
  name: 'wh.cities',
  permission: null,
  wh: 'catalog.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { wh, scoped } = actorOf(ctx);
    const rows = await scoped.whCity.findMany({ where: { restaurantId: wh.restaurantId }, orderBy: { code: 'asc' } });
    return rows.map((c) => ({ id: c.id, code: c.code, name: c.name as { ckb: string; ar: string; en: string } }));
  },
});

/** The stock list: a partner sees every warehouse with its average cost, a rep only his own warehouse, quantities only. */
export const stockQuery = defineQuery({
  name: 'wh.stock',
  permission: null,
  wh: 'stock.view',
  input: whPlaceInput,
  target: whTargetOf,
  run: async (ctx) => {
    const { wh, scoped } = actorOf(ctx);
    const rows = await stockFor(scoped, wh.restaurantId, { role: wh.role, userId: wh.userId, canSeeCost: canWh(wh.role, 'cost.view') });
    return rows.map((r) => ({
      warehouseId: r.warehouseId,
      warehouseKind: r.warehouseKind,
      warehouseName: r.warehouseName,
      itemId: r.itemId,
      itemCode: r.itemCode,
      itemNames: r.itemNames,
      baseUnit: r.baseUnit,
      qtyBase: r.qtyBase.toFixed(),
      ...('avgCostIqd' in r ? { avgCostIqd: r.avgCostIqd.toFixed() } : {}),
    }));
  },
});

export const staffQuery = defineQuery({
  name: 'wh.staff',
  permission: null,
  wh: 'staff.manage',
  input: whPlaceInput.extend({ includeInactive: z.boolean().optional() }),
  target: whTargetOf,
  run: async (ctx, input) => {
    const { wh, scoped } = actorOf(ctx);
    const rows = await scoped.whStaff.findMany({
      where: { restaurantId: wh.restaurantId, ...(input.includeInactive ? {} : { deactivatedAt: null }) },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, role: true, warehouseId: true, deactivatedAt: true, user: { select: { name: true, email: true } } },
    });
    return rows.map((r) => ({ userId: r.userId, name: r.user.name, email: r.user.email, role: r.role, warehouseId: r.warehouseId, active: r.deactivatedAt === null }));
  },
});

