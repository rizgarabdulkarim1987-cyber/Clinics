import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { ForbiddenError } from '@/server/domain/wholesale/permissions';
import { createCustomer, createItem, seedCities } from '@/server/wholesale/catalog';
import { importOpeningTx } from '@/server/wholesale/import/opening';
import { InvalidStockError } from '@/server/domain/wholesale/costing';
import { listStockCounts, postStockCountTx } from '@/server/wholesale/stockCount';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import { stockValue } from '@/server/wholesale/posting/reports';
import { seedWarehouses } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Stock count: shortages and surpluses are booked at once. */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
type Tx = Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0];
const run = <T>(rid: string, fn: (tx: Tx) => Promise<T>) => db(rid).$transaction(fn);

const PARTNER = { id: 'u-partner', role: 'PARTNER' as const };
const REP = { id: 'u-rep', role: 'REP' as const };
let A: string;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  A = (await prisma().restaurant.create({ data: { name: 'Company A', sector: 'WHOLESALE' } })).id;
  await run(A, async (tx) => {
    await seedWarehouses(tx, A);
    await seedCities(tx, A);
    await seedChartOfAccounts(tx, A);
    const city = await tx.whCity.findFirstOrThrow();
    await createItem(tx, A, { code: 'RICE', names: { en: 'Rice' }, baseUnit: 'PIECE', units: [{ unit: 'PIECE', factorToBase: '1' }] });
    await createCustomer(tx, A, { name: 'Shop', cityId: city.id });
    await tx.whSupplier.create({ data: { restaurantId: A, name: 'Mill', isForeign: false } as never });
  });
});


const count = (counts: { itemId: string; countedBase: string; unitCostIqd?: string }[], user = PARTNER) =>
  run(A, async (tx) => {
    const w = await tx.whWarehouse.findFirstOrThrow({ where: { kind: 'MAIN' } });
    return postStockCountTx(tx, A, user, { warehouseId: w.id, counts });
  });
const rice = () => run(A, (tx) => tx.whItem.findFirstOrThrow({ where: { code: 'RICE' } }));

describe('stock count', () => {
  beforeEach(async () => {
    await run(A, (tx) => importOpeningTx(tx, A, PARTNER, 'item,qty,unit_cost,currency\nRICE,100,2000,IQD', 'STOCK'));
  });

  it('a shortage is a loss at the average cost', async () => {
    const r = await count([{ itemId: (await rice()).id, countedBase: '90' }]);
    expect(r.differences).toBe(1);
    expect((await run(A, (tx) => stockValue(tx))).totalIqd.toString()).toBe('180000');
    const [c] = await run(A, (tx) => listStockCounts(tx));
    expect(c!.lossIqd).toBe('20000');
  });

  it('a surplus is a gain at the average, an equal count moves nothing', async () => {
    await count([{ itemId: (await rice()).id, countedBase: '105' }]);
    expect((await run(A, (tx) => stockValue(tx))).totalIqd.toString()).toBe('210000');
    const same = await count([{ itemId: (await rice()).id, countedBase: '105' }]);
    expect(same.differences).toBe(0);
    expect(same.entryId).toBeNull();
  });

  it('refuses a duplicate item, a negative count and a rep', async () => {
    const id = (await rice()).id;
    await expect(count([{ itemId: id, countedBase: '1' }, { itemId: id, countedBase: '2' }])).rejects.toThrow(InvalidStockError);
    await expect(count([{ itemId: id, countedBase: '-1' }])).rejects.toThrow(InvalidStockError);
    await expect(count([{ itemId: id, countedBase: '1' }], REP)).rejects.toThrow(ForbiddenError);
  });
});
