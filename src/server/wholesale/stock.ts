import { randomUUID } from 'node:crypto';
import type Decimal from 'decimal.js';
import type { Prisma } from '@/generated/prisma/client';
import {
  InsufficientStockError,
  InvalidStockError,
  NoStockToRecostError,
  QTY_DP,
  assertCost,
  assertQty,
  recostAvg,
  roundCost,
  weightedAvg,
} from '@/server/domain/wholesale/costing';
import { D } from '@/server/domain/wholesale/money';
import { isIsoDate } from '@/server/domain/wholesale/rates';
import type { Names, Unit } from '@/server/domain/wholesale/catalog';
import type { ScopedTx } from '@/server/data/tenant-db';

export { InsufficientStockError, InvalidStockError, NoStockToRecostError } from '@/server/domain/wholesale/costing';

/*
 * Stock engine. Quantities are in the item's base unit; costs are IQD per base unit (weighted average per item per
 * warehouse, stored with 8 dp). Rules:
 * - Every write locks the item row FOR SHARE (so updateItem, which takes FOR UPDATE, cannot change units under it)
 *   and the StockBalance row(s) FOR UPDATE before reading quantities. Balance rows are created with
 *   INSERT ... ON CONFLICT DO NOTHING before locking, so concurrent first receipts are safe.
 * - Callers that touch several items in one transaction (a purchase or sale with many lines) MUST first call
 *   lockStockRows with every (item, warehouse) pair they will touch: it locks them all in one (itemId, warehouseId)
 *   order, so two such transactions can never deadlock. (Calling the functions below in itemId order is the only
 *   alternative.)
 * - NO permission checks in receiveStock/issueStock/transferStock/recostOnHand (like postJournal): the document
 *   (purchase, sale, transfer form...) that calls them checks requireCan first. They write StockMovement rows
 *   (append-only, DB trigger) and an AuditLog row in the caller's transaction.
 * - Stock movements post NO ledger entry by themselves; the document that moves stock posts its own journal entry.
 *   A transfer between our own warehouses posts none at all: the company's inventory value does not change.
 */

type Db = ScopedTx
type Dec = Decimal | InstanceType<typeof D>
type DD = InstanceType<typeof D>
export type StockRef = { type: string; id: string }
type Actor = { id: string }

const LIMIT = new D(10).pow(24 - QTY_DP)
const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`)

function cleanRef(ref: unknown): StockRef {
  const r = ref as Partial<StockRef> | null | undefined
  const type = typeof r?.type === 'string' ? r.type.trim() : ''
  const id = typeof r?.id === 'string' ? r.id.trim() : ''
  if (!type || !id) throw new InvalidStockError('ref type and id are required')
  return { type, id }
}

function cleanActor(user: unknown): Actor {
  const id = (user as Actor | undefined)?.id
  if (typeof id !== 'string' || !id) throw new InvalidStockError('user is required')
  return { id }
}

function cleanExpiry(expiry: unknown): Date | null {
  if (expiry === undefined || expiry === null || expiry === '') return null
  if (!isIsoDate(expiry)) throw new InvalidStockError(`invalid expiry date: ${String(expiry)}`)
  return toDbDate(expiry)
}

/** Shared lock on the item row: blocks updateItem's unit changes until this transaction ends. Also checks it exists. */
async function lockItem(tx: Db, rid: string, itemId: string): Promise<void> {
  if (typeof itemId !== 'string' || !itemId) throw new InvalidStockError('item is required')
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "WhItem" WHERE id = ${itemId} AND "restaurantId" = ${rid} FOR SHARE`
  if (!rows.length) throw new InvalidStockError(`unknown item: ${itemId}`)
}

async function requireWarehouse(tx: Db, rid: string, id: string): Promise<{ id: string; kind: string }> {
  if (typeof id !== 'string' || !id) throw new InvalidStockError('warehouse is required')
  const w = await tx.whWarehouse.findFirst({ where: { id, restaurantId: rid }, select: { id: true, kind: true } })
  if (!w) throw new InvalidStockError(`unknown warehouse: ${id}`)
  return w
}

async function ensureBalanceRow(tx: Db, rid: string, itemId: string, warehouseId: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "WhStockBalance" ("id", "restaurantId", "itemId", "warehouseId", "qtyBase", "avgCostIqd", "updatedAt")
    VALUES (gen_random_uuid()::text, ${rid}, ${itemId}, ${warehouseId}, 0, 0, now())
    ON CONFLICT ("restaurantId", "itemId", "warehouseId") DO NOTHING`
}

type LockedBalance = { id: string; qty: DD; avg: DD }

/** SELECT ... FOR UPDATE on the balance row(s) of one item, in warehouseId order (stable lock order). */
async function lockBalances(tx: Db, rid: string, itemId: string, warehouseIds: string[]): Promise<Map<string, LockedBalance>> {
  const ids = [...new Set(warehouseIds)].sort()
  const rows = await tx.$queryRaw<{ id: string; warehouseId: string; qtyBase: string; avgCostIqd: string }[]>`
    SELECT "id", "warehouseId", "qtyBase"::text AS "qtyBase", "avgCostIqd"::text AS "avgCostIqd"
    FROM "WhStockBalance"
    WHERE "restaurantId" = ${rid} AND "itemId" = ${itemId} AND "warehouseId" = ANY(${ids}::text[])
    ORDER BY "warehouseId"
    FOR UPDATE`
  return new Map(rows.map((r) => [r.warehouseId, { id: r.id, qty: new D(r.qtyBase), avg: new D(r.avgCostIqd) }]))
}

export type StockRow = { itemId: string; warehouseId: string; qtyBase: Decimal; avgCostIqd: Decimal }
export const stockKey = (itemId: string, warehouseId: string): string => `${itemId}|${warehouseId}`

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Lock every (item, warehouse) pair a multi-item document will touch, in one stable order, before touching any of
 * them: the items FOR SHARE (itemId order), then a balance row for each pair is created if missing, then all the
 * balance rows are locked FOR UPDATE in one ordered SELECT (itemId, warehouseId). Duplicates are ignored. The later
 * receive/issue/recost calls re-lock rows this transaction already holds, which never waits. Returns the locked
 * balances keyed by stockKey(itemId, warehouseId), in that order. No permission check (the document checks).
 */
export async function lockStockRows(tx: Db, rid: string, pairs: { itemId: string; warehouseId: string }[]): Promise<Map<string, StockRow>> {
  const uniq = new Map<string, { itemId: string; warehouseId: string }>()
  for (const p of pairs) {
    if (typeof p?.itemId !== 'string' || !p.itemId) throw new InvalidStockError('item is required')
    if (typeof p?.warehouseId !== 'string' || !p.warehouseId) throw new InvalidStockError('warehouse is required')
    uniq.set(stockKey(p.itemId, p.warehouseId), { itemId: p.itemId, warehouseId: p.warehouseId })
  }
  const sorted = [...uniq.values()].sort((a, b) => cmp(a.itemId, b.itemId) || cmp(a.warehouseId, b.warehouseId))
  const out = new Map<string, StockRow>()
  if (!sorted.length) return out
  for (const itemId of [...new Set(sorted.map((p) => p.itemId))]) await lockItem(tx, rid, itemId)
  for (const warehouseId of [...new Set(sorted.map((p) => p.warehouseId))].sort(cmp)) await requireWarehouse(tx, rid, warehouseId)
  for (const p of sorted) await ensureBalanceRow(tx, rid, p.itemId, p.warehouseId)
  const items = sorted.map((p) => p.itemId)
  const whs = sorted.map((p) => p.warehouseId)
  const rows = await tx.$queryRaw<{ itemId: string; warehouseId: string; qtyBase: string; avgCostIqd: string }[]>`
    SELECT b."itemId", b."warehouseId", b."qtyBase"::text AS "qtyBase", b."avgCostIqd"::text AS "avgCostIqd"
    FROM "WhStockBalance" b
    JOIN unnest(${items}::text[], ${whs}::text[]) AS p("itemId", "warehouseId")
      ON p."itemId" = b."itemId" AND p."warehouseId" = b."warehouseId"
    WHERE b."restaurantId" = ${rid}
    ORDER BY b."itemId", b."warehouseId"
    FOR UPDATE OF b`
  const byKey = new Map(rows.map((r) => [stockKey(r.itemId, r.warehouseId), r]))
  for (const p of sorted) {
    const r = byKey.get(stockKey(p.itemId, p.warehouseId))!
    out.set(stockKey(p.itemId, p.warehouseId), { itemId: p.itemId, warehouseId: p.warehouseId, qtyBase: new D(r.qtyBase), avgCostIqd: new D(r.avgCostIqd) })
  }
  return out
}

type Move = {
  restaurantId: string
  type: 'RECEIPT' | 'ISSUE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'RECOST'
  itemId: string
  warehouseId: string
  qtyBase: DD
  unitCostIqd: DD
  qtyAfter: DD
  avgAfter: DD
  addedCostIqd?: DD
  ref: StockRef
  userId: string
}

async function writeMove(tx: Db, m: Move): Promise<void> {
  await tx.whStockMovement.create({
    data: {
      restaurantId: m.restaurantId,
      type: m.type,
      itemId: m.itemId,
      warehouseId: m.warehouseId,
      qtyBase: m.qtyBase.toFixed(),
      unitCostIqd: m.unitCostIqd.toFixed(),
      qtyAfterBase: m.qtyAfter.toFixed(),
      avgCostAfterIqd: m.avgAfter.toFixed(),
      addedCostIqd: m.addedCostIqd?.toFixed() ?? null,
      refType: m.ref.type,
      refId: m.ref.id,
      userId: m.userId,
    },
  })
}

type BatchPortion = { expiry: Date | null; qty: DD }

/** Add to the (item, warehouse, expiry) batch rows. Caller holds the balance lock. */
async function addBatches(tx: Db, rid: string, itemId: string, warehouseId: string, portions: BatchPortion[]): Promise<void> {
  for (const p of portions) {
    const row = await tx.whBatch.findFirst({ where: { restaurantId: rid, itemId, warehouseId, expiry: p.expiry }, select: { id: true, qtyBase: true } })
    if (row) await tx.whBatch.update({ where: { id: row.id }, data: { qtyBase: new D(row.qtyBase.toString()).plus(p.qty).toFixed() } })
    else await tx.whBatch.create({ data: { restaurantId: rid, itemId, warehouseId, expiry: p.expiry, qtyBase: p.qty.toFixed() } })
  }
}

/** Take `qty` from the batches, oldest expiry first, no-expiry last. Returns what was taken per expiry. */
async function takeBatches(tx: Db, rid: string, itemId: string, warehouseId: string, qty: DD): Promise<BatchPortion[]> {
  const rows = await tx.whBatch.findMany({
    where: { restaurantId: rid, itemId, warehouseId, qtyBase: { gt: 0 } },
    orderBy: [{ expiry: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    select: { id: true, qtyBase: true, expiry: true },
  })
  let left = qty
  const taken: BatchPortion[] = []
  for (const r of rows) {
    if (left.isZero()) break
    const have = new D(r.qtyBase.toString())
    const take = D.min(have, left)
    await tx.whBatch.update({ where: { id: r.id }, data: { qtyBase: have.minus(take).toFixed() } })
    taken.push({ expiry: r.expiry, qty: take })
    left = left.minus(take)
  }
  // Batches always sum to the balance (both written only here, under the balance lock).
  if (!left.isZero()) throw new Error(`stock batches out of step with the balance for item ${itemId} in warehouse ${warehouseId}`)
  return taken
}

type InArgs = { restaurantId: string; itemId: string; warehouseId: string; qty: DD; cost: DD; batches: BatchPortion[]; ref: StockRef; userId: string; type: 'RECEIPT' | 'TRANSFER_IN' }

/** Receive under lock. The balance row must already exist (ensureBalanceRow) and be locked by this transaction. */
async function lockedReceive(tx: Db, a: InArgs, bal: LockedBalance): Promise<{ qtyAfter: DD; avgAfter: DD }> {
  const qtyAfter = bal.qty.plus(a.qty)
  if (qtyAfter.gte(LIMIT)) throw new InvalidStockError('resulting quantity is too large')
  const avgAfter = roundCost(weightedAvg(bal.qty, bal.avg, a.qty, a.cost))
  await tx.whStockBalance.update({ where: { id: bal.id }, data: { qtyBase: qtyAfter.toFixed(), avgCostIqd: avgAfter.toFixed() } })
  await addBatches(tx, a.restaurantId, a.itemId, a.warehouseId, a.batches)
  await writeMove(tx, { restaurantId: a.restaurantId, type: a.type, itemId: a.itemId, warehouseId: a.warehouseId, qtyBase: a.qty, unitCostIqd: a.cost, qtyAfter, avgAfter, ref: a.ref, userId: a.userId })
  return { qtyAfter, avgAfter }
}

type OutArgs = { restaurantId: string; itemId: string; warehouseId: string; qty: DD; ref: StockRef; userId: string; type: 'ISSUE' | 'TRANSFER_OUT' }

/** Issue under lock (`bal` undefined = no balance row = nothing on hand). Returns the average it left at. */
async function lockedIssue(tx: Db, a: OutArgs, bal: LockedBalance | undefined): Promise<{ cost: DD; qtyAfter: DD; batches: BatchPortion[] }> {
  const available = bal?.qty ?? new D(0)
  if (!bal || available.lt(a.qty)) throw new InsufficientStockError(a.itemId, a.warehouseId, available, a.qty)
  const qtyAfter = bal.qty.minus(a.qty)
  await tx.whStockBalance.update({ where: { id: bal.id }, data: { qtyBase: qtyAfter.toFixed() } })
  const batches = await takeBatches(tx, a.restaurantId, a.itemId, a.warehouseId, a.qty)
  await writeMove(tx, { restaurantId: a.restaurantId, type: a.type, itemId: a.itemId, warehouseId: a.warehouseId, qtyBase: a.qty.neg(), unitCostIqd: bal.avg, qtyAfter, avgAfter: bal.avg, ref: a.ref, userId: a.userId })
  return { cost: bal.avg, qtyAfter, batches }
}

export type ReceiveArgs = { restaurantId: string;
  itemId: string
  warehouseId: string
  qtyBase: Dec
  /** IQD per base unit; rounded half-up to 8 dp. */
  unitCostIqd: Dec
  /** 'YYYY-MM-DD' or null/undefined for no expiry. */
  expiry?: string | null
  ref: StockRef
  user: Actor
}

/**
 * Add stock at `unitCostIqd`, recomputing the warehouse's weighted average (into 0 on hand: the incoming cost).
 * Returns the unit cost actually stored on the movement (rounded half-up to 8 dp). A document posting the receipt
 * to INVENTORY must value it as qty x this returned cost (summed over the entry, then rounded once to 4 dp) so the
 * ledger and the stock engine agree.
 */
export async function receiveStock(tx: Db, a: ReceiveArgs): Promise<{ unitCostIqd: Decimal }> {
  const qty = assertQty(a.qtyBase)
  const cost = assertCost(a.unitCostIqd)
  const expiry = cleanExpiry(a.expiry)
  const ref = cleanRef(a.ref)
  const user = cleanActor(a.user)
  await lockItem(tx, a.restaurantId, a.itemId)
  await requireWarehouse(tx, a.restaurantId, a.warehouseId)
  await ensureBalanceRow(tx, a.restaurantId, a.itemId, a.warehouseId)
  const bal = (await lockBalances(tx, a.restaurantId, a.itemId, [a.warehouseId])).get(a.warehouseId)!
  const r = await lockedReceive(tx, { restaurantId: a.restaurantId, itemId: a.itemId, warehouseId: a.warehouseId, qty, cost, batches: [{ expiry, qty }], ref, userId: user.id, type: 'RECEIPT' }, bal)
  return { unitCostIqd: cost }
}

export type IssueArgs = { restaurantId: string; itemId: string; warehouseId: string; qtyBase: Dec; ref: StockRef; user: Actor }

/** What an issue took from one expiry batch ('YYYY-MM-DD' or null for no expiry), in base units. */
export type IssuedPortion = { expiry: string | null; qtyBase: Decimal }

/**
 * Take stock out at the current weighted average (returned, 8 dp; the caller multiplies by qty for the COGS line).
 * Locks the balance row FOR UPDATE first; throws InsufficientStockError if the balance would go negative.
 * `batches` = what was taken from which expiry batch (oldest expiry first, no-expiry last); they sum to qtyBase.
 * A document that may later put the stock back (sale cancellation, returns) must keep them and receive each portion
 * back with its own expiry.
 */
export async function issueStock(tx: Db, a: IssueArgs): Promise<{ unitCostIqd: Decimal; batches: IssuedPortion[] }> {
  const qty = assertQty(a.qtyBase)
  const ref = cleanRef(a.ref)
  const user = cleanActor(a.user)
  await lockItem(tx, a.restaurantId, a.itemId)
  await requireWarehouse(tx, a.restaurantId, a.warehouseId)
  const bal = (await lockBalances(tx, a.restaurantId, a.itemId, [a.warehouseId])).get(a.warehouseId)
  const r = await lockedIssue(tx, { restaurantId: a.restaurantId, itemId: a.itemId, warehouseId: a.warehouseId, qty, ref, userId: user.id, type: 'ISSUE' }, bal)
  return { unitCostIqd: r.cost, batches: r.batches.map((b) => ({ expiry: b.expiry ? b.expiry.toISOString().slice(0, 10) : null, qtyBase: b.qty })) }
}

export type TransferArgs = { restaurantId: string; itemId: string; fromWarehouseId: string; toWarehouseId: string; qtyBase: Dec; ref: StockRef; user: Actor }

/**
 * Move stock between two warehouses at the source's current average cost; the destination re-averages with that
 * cost. Batches (expiries) travel with the stock. Both balance rows are locked in a fixed order, so opposite
 * transfers cannot deadlock. Posts no ledger entry (see the header comment).
 */
export async function transferStock(tx: Db, a: TransferArgs): Promise<void> {
  const qty = assertQty(a.qtyBase)
  const ref = cleanRef(a.ref)
  const user = cleanActor(a.user)
  if (a.fromWarehouseId === a.toWarehouseId) throw new InvalidStockError('cannot transfer to the same warehouse')
  await lockItem(tx, a.restaurantId, a.itemId)
  await requireWarehouse(tx, a.restaurantId, a.fromWarehouseId)
  await requireWarehouse(tx, a.restaurantId, a.toWarehouseId)
  await ensureBalanceRow(tx, a.restaurantId, a.itemId, a.toWarehouseId)
  const locked = await lockBalances(tx, a.restaurantId, a.itemId, [a.fromWarehouseId, a.toWarehouseId])
  const out = await lockedIssue(tx, { restaurantId: a.restaurantId, itemId: a.itemId, warehouseId: a.fromWarehouseId, qty, ref, userId: user.id, type: 'TRANSFER_OUT' }, locked.get(a.fromWarehouseId))
  const inn = await lockedReceive(
    tx,
    { restaurantId: a.restaurantId, itemId: a.itemId, warehouseId: a.toWarehouseId, qty, cost: out.cost, batches: out.batches, ref, userId: user.id, type: 'TRANSFER_IN' },
    locked.get(a.toWarehouseId)!,
  )
}

/**
 * Landed cost: add a TOTAL IQD amount (at most 4 dp) to the on-hand value of one item in one warehouse only:
 * new avg = (qty * avg + addedCost) / qty, stored at 8 dp. Throws NoStockToRecostError when nothing is on hand
 * (the caller decides where that cost goes, e.g. P&L for goods already sold).
 */
export async function recostOnHand(tx: Db, rid: string, itemId: string, warehouseId: string, addedCostIqd: Dec, ctx: { ref: StockRef; user: Actor }): Promise<void> {
  const added = assertCost(addedCostIqd, 'added cost')
  if (new D(addedCostIqd.toString()).decimalPlaces() > 4) throw new InvalidStockError('added cost has more than 4 decimal places')
  if (!added.gt(0)) throw new InvalidStockError('added cost must be greater than zero')
  const ref = cleanRef(ctx?.ref)
  const user = cleanActor(ctx?.user)
  await lockItem(tx, rid, itemId)
  await requireWarehouse(tx, rid, warehouseId)
  const bal = (await lockBalances(tx, rid, itemId, [warehouseId])).get(warehouseId)
  if (!bal || !bal.qty.gt(0)) throw new NoStockToRecostError(itemId, warehouseId)
  const avgAfter = roundCost(recostAvg(bal.qty, bal.avg, added, { itemId, warehouseId }))
  // Decimal(24,8) holds values below 1e16: refuse here instead of letting Postgres raise a numeric overflow.
  if (avgAfter.gte(LIMIT)) throw new InvalidStockError(`re-costed average is too large (${avgAfter.toFixed()} IQD per base unit)`)
  await tx.whStockBalance.update({ where: { id: bal.id }, data: { avgCostIqd: avgAfter.toFixed() } })
  await writeMove(tx, {
    restaurantId: rid,
    type: 'RECOST',
    itemId,
    warehouseId,
    qtyBase: new D(0),
    unitCostIqd: avgAfter.minus(bal.avg),
    qtyAfter: bal.qty,
    avgAfter,
    addedCostIqd: added,
    ref,
    userId: user.id,
  })
}

export type ReverseReceiptArgs = { restaurantId: string;
  itemId: string
  warehouseId: string
  qtyBase: Dec
  /** The unit cost the receipt was stored at (receiveStock's return value). */
  unitCostIqd: Dec
  /** The receipt's expiry: that batch is taken first. */
  expiry?: string | null
  ref: StockRef
  user: Actor
}

/**
 * Take a receipt back out (cancelling a purchase) at ITS OWN unit cost, not the current average, so the remaining
 * stock is valued as if the receipt never happened: new avg = (qty * avg - q * cost) / (qty - q), stored at 8 dp
 * (with nothing left the average is kept, as issueStock does). Writes an ISSUE movement at that cost. Throws
 * InsufficientStockError when less than `qtyBase` is on hand, InvalidStockError when the remaining value would be
 * negative beyond storage rounding. No permission check (the document checks).
 */
export async function reverseReceipt(tx: Db, a: ReverseReceiptArgs): Promise<void> {
  const qty = assertQty(a.qtyBase)
  const cost = assertCost(a.unitCostIqd)
  const expiry = cleanExpiry(a.expiry)
  const ref = cleanRef(a.ref)
  const user = cleanActor(a.user)
  await lockItem(tx, a.restaurantId, a.itemId)
  await requireWarehouse(tx, a.restaurantId, a.warehouseId)
  const bal = (await lockBalances(tx, a.restaurantId, a.itemId, [a.warehouseId])).get(a.warehouseId)
  const available = bal?.qty ?? new D(0)
  if (!bal || available.lt(qty)) throw new InsufficientStockError(a.itemId, a.warehouseId, available, qty)
  const qtyAfter = bal.qty.minus(qty)
  let value = bal.qty.times(bal.avg).minus(qty.times(cost))
  // Stored averages are rounded to 8 dp, so the remaining value can be off by up to qty * 0.5e-8: within that it is
  // rounding noise. Beyond it, refuse rather than lose value: a negative remainder, or emptying the balance while
  // value remains (the stock left was not this receipt's, e.g. it was sold and restocked at another cost).
  const tolerance = bal.qty.times('1e-8')
  if (value.isNegative() && !value.isZero()) {
    if (value.abs().gt(tolerance)) throw new InvalidStockError('reversing this receipt would leave a negative stock value')
    value = new D(0)
  }
  if (qtyAfter.isZero() && value.gt(tolerance))
    throw new InvalidStockError(`reversing this receipt would empty the balance but leave ${value.toFixed()} IQD of value`)
  const avgAfter = qtyAfter.isZero() ? bal.avg : roundCost(value.div(qtyAfter))
  await tx.whStockBalance.update({ where: { id: bal.id }, data: { qtyBase: qtyAfter.toFixed(), avgCostIqd: avgAfter.toFixed() } })
  // The receipt's own expiry batch first, then (if that batch was already partly used) oldest expiry first.
  let left = qty
  const own = await tx.whBatch.findFirst({ where: { restaurantId: a.restaurantId, itemId: a.itemId, warehouseId: a.warehouseId, expiry, qtyBase: { gt: 0 } }, select: { id: true, qtyBase: true } })
  if (own) {
    const have = new D(own.qtyBase.toString())
    const take = D.min(have, left)
    await tx.whBatch.update({ where: { id: own.id }, data: { qtyBase: have.minus(take).toFixed() } })
    left = left.minus(take)
  }
  if (left.gt(0)) await takeBatches(tx, a.restaurantId, a.itemId, a.warehouseId, left)
  await writeMove(tx, { restaurantId: a.restaurantId, type: 'ISSUE', itemId: a.itemId, warehouseId: a.warehouseId, qtyBase: qty.neg(), unitCostIqd: cost, qtyAfter, avgAfter, ref, userId: user.id })
}

/** Movements in the order they happened: (createdAt, seq). createdAt alone ties within one transaction. */
export function movementsOf(db: Db, where: Prisma.WhStockMovementWhereInput) {
  return db.whStockMovement.findMany({ where, orderBy: [{ createdAt: 'asc' }, { seq: 'asc' }] })
}

/** Quantity on hand (base units), 0 when the item was never in that warehouse. No lock; no permission check. */
export async function onHand(tx: Db, rid: string, itemId: string, warehouseId: string): Promise<Decimal> {
  const b = await tx.whStockBalance.findUnique({ where: { restaurantId_itemId_warehouseId: { restaurantId: rid, itemId, warehouseId } }, select: { qtyBase: true } })
  return new D(b ? b.qtyBase.toString() : 0)
}

