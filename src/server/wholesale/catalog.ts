import type { ScopedTx } from '@/server/data/tenant-db';
import {
  InvalidCatalogError,
  ItemLockedError,
  isUnit,
  optionalText,
  parseDecimal,
  requireText,
  validateNames,
  type Names,
  type Unit,
} from '@/server/domain/wholesale/catalog';
import { D } from '@/server/domain/wholesale/money';

export { InvalidCatalogError, ItemLockedError } from '@/server/domain/wholesale/catalog';

/*
 * Catalog services of one wholesale company: items (with their carton / piece / ton units and one IQD price per unit), cities,
 * customers and suppliers. Every function takes the company's scoped transaction and its `restaurantId` (raw SQL and creates
 * name it explicitly). No permission checks here: the Studio action that calls them holds the `wh` permission, and a rep's
 * limits (his own customers) are part of the query that reads them.
 */

type Db = ScopedTx;

/** A fixed list of cities (the dashboard groups sales by city). */
const CITIES: { code: string; name: Names }[] = [
  { code: 'erbil', name: { ckb: 'هەولێر', ar: 'أربيل', en: 'Erbil' } },
  { code: 'sulaymaniyah', name: { ckb: 'سلێمانی', ar: 'السليمانية', en: 'Sulaymaniyah' } },
  { code: 'dihok', name: { ckb: 'دهۆک', ar: 'دهوك', en: 'Duhok' } },
  { code: 'kirkuk', name: { ckb: 'کەرکووک', ar: 'كركوك', en: 'Kirkuk' } },
  { code: 'mosul', name: { ckb: 'موسڵ', ar: 'الموصل', en: 'Mosul' } },
  { code: 'baghdad', name: { ckb: 'بەغدا', ar: 'بغداد', en: 'Baghdad' } },
  { code: 'basra', name: { ckb: 'بەسرە', ar: 'البصرة', en: 'Basra' } },
  { code: 'najaf', name: { ckb: 'نەجەف', ar: 'النجف', en: 'Najaf' } },
  { code: 'karbala', name: { ckb: 'کەربەلا', ar: 'كربلاء', en: 'Karbala' } },
  { code: 'ramadi', name: { ckb: 'ڕەمادی', ar: 'الرمادي', en: 'Ramadi' } },
  { code: 'halabja', name: { ckb: 'هەڵەبجە', ar: 'حلبجة', en: 'Halabja' } },
  { code: 'zakho', name: { ckb: 'زاخۆ', ar: 'زاخو', en: 'Zakho' } },
];

/** Idempotent. */
export async function seedCities(tx: Db, rid: string): Promise<void> {
  for (const c of CITIES) {
    await tx.whCity.upsert({
      where: { restaurantId_code: { restaurantId: rid, code: c.code } },
      update: { name: c.name },
      create: { restaurantId: rid, code: c.code, name: c.name },
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------------------------

export type ItemInput = {
  code: string;
  names: Partial<Names>;
  category?: string | null;
  baseUnit: Unit;
  units: { unit: Unit; factorToBase: string; barcode?: string | null }[];
  /** In base units. */
  reorderPoint?: string | null;
  active?: boolean;
};

type CleanItem = {
  code: string;
  names: Names;
  category: string | null;
  baseUnit: Unit;
  units: { unit: Unit; factorToBase: string; barcode: string | null }[];
  reorderPoint: string | null;
  active?: boolean;
};

export function cleanItem(input: ItemInput): CleanItem {
  const code = requireText(input.code, 'code');
  const names = validateNames(input.names ?? {});
  if (!isUnit(input.baseUnit)) throw new InvalidCatalogError('invalid base unit');
  const seen = new Set<Unit>();
  const units = (input.units ?? []).map((u) => {
    if (!isUnit(u.unit)) throw new InvalidCatalogError(`invalid unit: ${String(u.unit)}`);
    if (seen.has(u.unit)) throw new InvalidCatalogError(`duplicate unit: ${u.unit}`);
    seen.add(u.unit);
    const factor = parseDecimal(u.factorToBase, { dp: 8, label: `${u.unit} factor`, positive: true });
    if (u.unit === input.baseUnit && !factor.eq(1)) throw new InvalidCatalogError('the base unit must have factor 1');
    return { unit: u.unit, factorToBase: factor.toFixed(), barcode: optionalText(u.barcode) };
  });
  if (!seen.has(input.baseUnit)) units.unshift({ unit: input.baseUnit, factorToBase: '1', barcode: null });
  const barcodes = units.map((u) => u.barcode).filter((b): b is string => b !== null);
  if (new Set(barcodes).size !== barcodes.length) throw new InvalidCatalogError('duplicate barcode');
  const rp = optionalText(input.reorderPoint);
  return {
    code,
    names,
    category: optionalText(input.category),
    baseUnit: input.baseUnit,
    units,
    reorderPoint: rp === null ? null : parseDecimal(rp, { dp: 8, label: 'reorder point' }).toFixed(),
    active: input.active,
  };
}

async function assertItemUnique(tx: Db, rid: string, c: CleanItem, selfId?: string): Promise<void> {
  const clash = await tx.whItem.findFirst({ where: { restaurantId: rid, code: c.code, ...(selfId ? { id: { not: selfId } } : {}) }, select: { id: true } });
  if (clash) throw new InvalidCatalogError(`item code already exists: ${c.code}`);
  const barcodes = c.units.map((u) => u.barcode).filter((b): b is string => b !== null);
  if (barcodes.length) {
    const b = await tx.whItemUnit.findFirst({
      where: { restaurantId: rid, barcode: { in: barcodes }, ...(selfId ? { itemId: { not: selfId } } : {}) },
      select: { barcode: true },
    });
    if (b) throw new InvalidCatalogError(`barcode already exists: ${b.barcode}`);
  }
}

export async function createItem(tx: Db, rid: string, input: ItemInput): Promise<{ id: string; code: string }> {
  const c = cleanItem(input);
  await assertItemUnique(tx, rid, c);
  return tx.whItem.create({
    data: {
      restaurantId: rid,
      code: c.code,
      names: c.names,
      category: c.category,
      baseUnit: c.baseUnit,
      reorderPoint: c.reorderPoint,
      active: c.active ?? true,
      units: { create: c.units.map((u) => ({ restaurantId: rid, ...u })) },
    },
    select: { id: true, code: true },
  });
}

/** True once any balance, movement or batch row exists for the item (even if the quantity is back at 0). */
async function hasStock(tx: Db, rid: string, itemId: string): Promise<boolean> {
  const [b, m, bt] = await Promise.all([
    tx.whStockBalance.findFirst({ where: { restaurantId: rid, itemId }, select: { id: true } }),
    tx.whStockMovement.findFirst({ where: { restaurantId: rid, itemId }, select: { id: true } }),
    tx.whBatch.findFirst({ where: { restaurantId: rid, itemId }, select: { id: true } }),
  ]);
  return Boolean(b || m || bt);
}

/**
 * Replaces the item's fields and unit list. Removing a unit also removes its price. Archive with `active: false`.
 * Once the item has stock, the base unit, existing unit factors and the unit list (no removals) are frozen
 * (ItemLockedError); adding a unit and every other field stay editable. The item row is locked FOR UPDATE first;
 * stock writes take FOR SHARE on it, so a receipt cannot slip in between the check and the change.
 */
export async function updateItem(tx: Db, rid: string, id: string, input: ItemInput): Promise<{ previous: Record<string, unknown>; next: Record<string, unknown> }> {
  // eslint-disable-next-line no-restricted-properties -- a row lock on one item, matched only inside this company
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "WhItem" WHERE id = ${id} AND "restaurantId" = ${rid} FOR UPDATE`;
  if (!locked.length) throw new InvalidCatalogError('item not found');
  const prev = await tx.whItem.findFirstOrThrow({ where: { id, restaurantId: rid }, include: { units: { orderBy: { unit: 'asc' } } } });
  const c = cleanItem(input);
  await assertItemUnique(tx, rid, c, id);
  if (await hasStock(tx, rid, id)) {
    if (c.baseUnit !== prev.baseUnit) throw new ItemLockedError(id, 'the base unit cannot change');
    for (const old of prev.units) {
      const now = c.units.find((u) => u.unit === old.unit);
      if (!now) throw new ItemLockedError(id, `the ${old.unit} unit cannot be removed`);
      if (!new D(now.factorToBase).eq(old.factorToBase.toString())) throw new ItemLockedError(id, `the ${old.unit} factor cannot change`);
    }
  }
  const previous = {
    code: prev.code,
    category: prev.category,
    baseUnit: prev.baseUnit,
    reorderPoint: prev.reorderPoint?.toFixed() ?? null,
    active: prev.active,
    units: prev.units.map((u) => `${u.unit}=${u.factorToBase.toFixed()}`).join(','),
  };
  const keep = c.units.map((u) => u.unit);
  await tx.whPriceListEntry.deleteMany({ where: { restaurantId: rid, itemId: id, unit: { notIn: keep } } });
  await tx.whItemUnit.deleteMany({ where: { restaurantId: rid, itemId: id, unit: { notIn: keep } } });
  for (const u of c.units) {
    await tx.whItemUnit.upsert({
      where: { restaurantId_itemId_unit: { restaurantId: rid, itemId: id, unit: u.unit } },
      update: { factorToBase: u.factorToBase, barcode: u.barcode },
      create: { restaurantId: rid, itemId: id, ...u },
    });
  }
  await tx.whItem.update({
    where: { id },
    data: {
      code: c.code,
      names: c.names,
      category: c.category,
      baseUnit: c.baseUnit,
      reorderPoint: c.reorderPoint,
      ...(c.active === undefined ? {} : { active: c.active }),
    },
  });
  return {
    previous,
    next: { code: c.code, category: c.category, baseUnit: c.baseUnit, reorderPoint: c.reorderPoint, active: c.active ?? prev.active, units: c.units.map((u) => `${u.unit}=${u.factorToBase}`).join(',') },
  };
}

export type PriceInput = { unit: Unit; priceIqd: string };

/** One IQD price per unit. A blank price removes that unit's entry. Units the item does not have are refused. */
export async function setItemPrices(tx: Db, rid: string, itemId: string, prices: PriceInput[]): Promise<{ unit: Unit; priceIqd: string | null }[]> {
  const item = await tx.whItem.findFirst({ where: { id: itemId, restaurantId: rid }, include: { units: { select: { unit: true } } } });
  if (!item) throw new InvalidCatalogError('item not found');
  const have = new Set(item.units.map((u) => u.unit));
  const done: { unit: Unit; priceIqd: string | null }[] = [];
  for (const p of prices) {
    if (!isUnit(p.unit) || !have.has(p.unit)) throw new InvalidCatalogError(`item has no ${String(p.unit)} unit`);
    const raw = typeof p.priceIqd === 'string' ? p.priceIqd.trim() : p.priceIqd;
    if (raw === '') {
      await tx.whPriceListEntry.deleteMany({ where: { restaurantId: rid, itemId, unit: p.unit } });
      done.push({ unit: p.unit, priceIqd: null });
      continue;
    }
    const price = parseDecimal(raw, { dp: 4, label: `${p.unit} price` }).toFixed();
    await tx.whPriceListEntry.upsert({
      where: { restaurantId_itemId_unit: { restaurantId: rid, itemId, unit: p.unit } },
      update: { priceIqd: price },
      create: { restaurantId: rid, itemId, unit: p.unit, priceIqd: price },
    });
    done.push({ unit: p.unit, priceIqd: price });
  }
  return done;
}

const itemInclude = {
  units: { orderBy: { unit: 'asc' } },
  prices: { orderBy: { unit: 'asc' } },
} as const;

export function listItems(tx: Db, rid: string) {
  return tx.whItem.findMany({ where: { restaurantId: rid }, orderBy: { code: 'asc' }, include: itemInclude });
}

export function getItem(tx: Db, rid: string, id: string) {
  return tx.whItem.findFirst({ where: { id, restaurantId: rid }, include: itemInclude });
}

// ---------------------------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------------------------

export type CustomerInput = {
  name: string;
  phone?: string | null;
  cityId: string;
  /** The user id of the rep this customer belongs to (a `WhStaff` row with the REP role). */
  repId?: string | null;
  creditLimitIqd?: string | null;
  active?: boolean;
};

async function cleanCustomer(tx: Db, rid: string, input: CustomerInput) {
  const name = requireText(input.name, 'name');
  const city = await tx.whCity.findFirst({ where: { id: String(input.cityId), restaurantId: rid }, select: { id: true } });
  if (!city) throw new InvalidCatalogError('unknown city');
  const repId = optionalText(input.repId);
  if (repId !== null) {
    const rep = await tx.whStaff.findFirst({ where: { restaurantId: rid, userId: repId, role: 'REP', deactivatedAt: null }, select: { id: true } });
    if (!rep) throw new InvalidCatalogError('rep must be an active rep of this company');
  }
  const limit = optionalText(input.creditLimitIqd);
  return {
    name,
    phone: optionalText(input.phone),
    cityId: city.id,
    repId,
    creditLimitIqd: limit === null ? null : parseDecimal(limit, { dp: 4, label: 'credit limit' }).toFixed(),
  };
}

export async function createCustomer(tx: Db, rid: string, input: CustomerInput): Promise<{ id: string }> {
  const c = await cleanCustomer(tx, rid, input);
  return tx.whCustomer.create({ data: { restaurantId: rid, ...c, active: input.active ?? true }, select: { id: true } });
}

export async function updateCustomer(tx: Db, rid: string, id: string, input: CustomerInput): Promise<void> {
  if (!(await tx.whCustomer.findFirst({ where: { id, restaurantId: rid }, select: { id: true } }))) throw new InvalidCatalogError('customer not found');
  const c = await cleanCustomer(tx, rid, input);
  await tx.whCustomer.update({ where: { id }, data: { ...c, ...(input.active === undefined ? {} : { active: input.active }) } });
}

/** A partner sees every customer; a rep only those assigned to him. The restriction is part of the query itself. */
export function listCustomers(tx: Db, rid: string, viewer: { role: 'OWNER' | 'PARTNER' | 'REP'; userId: string }) {
  return tx.whCustomer.findMany({
    where: { restaurantId: rid, ...(viewer.role === 'REP' ? { repId: viewer.userId } : {}) },
    orderBy: { name: 'asc' },
    include: { city: true },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Suppliers (never visible to a rep)
// ---------------------------------------------------------------------------------------------------------------

export type SupplierInput = { name: string; phone?: string | null; country?: string | null; isForeign: boolean; active?: boolean };

function cleanSupplier(input: SupplierInput) {
  return {
    name: requireText(input.name, 'name'),
    phone: optionalText(input.phone),
    country: optionalText(input.country),
    isForeign: Boolean(input.isForeign),
  };
}

export async function createSupplier(tx: Db, rid: string, input: SupplierInput): Promise<{ id: string }> {
  const s = cleanSupplier(input);
  return tx.whSupplier.create({ data: { restaurantId: rid, ...s, active: input.active ?? true }, select: { id: true } });
}

export async function updateSupplier(tx: Db, rid: string, id: string, input: SupplierInput): Promise<void> {
  if (!(await tx.whSupplier.findFirst({ where: { id, restaurantId: rid }, select: { id: true } }))) throw new InvalidCatalogError('supplier not found');
  const s = cleanSupplier(input);
  await tx.whSupplier.update({ where: { id }, data: { ...s, ...(input.active === undefined ? {} : { active: input.active }) } });
}

export function listSuppliers(tx: Db, rid: string) {
  return tx.whSupplier.findMany({ where: { restaurantId: rid }, orderBy: { name: 'asc' } });
}
