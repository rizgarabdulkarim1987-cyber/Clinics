import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAiProviderForTests } from '@/server/ai/provider';
import type { AiProvider } from '@/server/ai/provider/types';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { periodFor, toolsFor } from '@/server/domain/wholesale/assistant';
import { D } from '@/server/domain/wholesale/money';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { askAssistant } from '@/server/wholesale/assistant';
import { createCustomer, createItem, seedCities, setItemPrices } from '@/server/wholesale/catalog';
import { seedChartOfAccounts } from '@/server/wholesale/ledger';
import { postSaleTx } from '@/server/wholesale/posting/sale';
import { setRate } from '@/server/wholesale/rates';
import { receiveStock } from '@/server/wholesale/stock';
import { seedWarehouses, warehouseOfKind } from '@/server/wholesale/warehouses';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** The accounting assistant: tools chosen by code, tables from the books, the model only phrases and is checked. */

const prisma = () => getPrisma();
const db = (restaurantId: string) => scopedClient(prisma(), { restaurantId });
const today = baghdadDate();
const PARTNER = { id: 'u-partner', role: 'PARTNER' as const };
let A: string;
const run = <T>(fn: (tx: Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]) => Promise<T>) => db(A).$transaction(fn);
const ask = (q: string) => askAssistant(run, { rid: A, user: PARTNER, locale: 'en' }, q);

const reply = (text: string): AiProvider => ({ name: 'fake', complete: vi.fn(async () => ({ stop: 'end' as const, content: [{ type: 'text' as const, text }], model: 'x', inputTokens: 1, outputTokens: 1 })) });

/** A model that first asks for a tool, then words the answer from what the tool returned. */
const usesTool = (tool: string, input: unknown, text: string): AiProvider => {
  let round = 0;
  return {
    name: 'fake',
    complete: vi.fn(async () =>
      round++ === 0
        ? { stop: 'tool_use' as const, content: [{ type: 'tool_use' as const, id: 't1', name: tool, input }], model: 'x', inputTokens: 1, outputTokens: 1 }
        : { stop: 'end' as const, content: [{ type: 'text' as const, text }], model: 'x', inputTokens: 1, outputTokens: 1 },
    ),
  };
};

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

afterEach(() => setAiProviderForTests(undefined));

beforeEach(async () => {
  await resetTestData(prisma());
  A = (await prisma().restaurant.create({ data: { name: 'Company A', sector: 'WHOLESALE' } })).id;
  await prisma().user.create({ data: { id: PARTNER.id, name: 'p', email: 'p@example.com' } });
  await run(async (tx) => {
    await seedWarehouses(tx, A);
    await seedCities(tx, A);
    await seedChartOfAccounts(tx, A);
    await setRate(tx, A, today, 'USD', '1500');
    const city = await tx.whCity.findFirstOrThrow();
    const item = (await createItem(tx, A, { code: 'RICE', names: { en: 'Rice', ar: 'رز', ckb: 'برنج' }, baseUnit: 'PIECE', units: [{ unit: 'PIECE', factorToBase: '1' }] })).id;
    await setItemPrices(tx, A, item, [{ unit: 'PIECE', priceIqd: '3000' }]);
    const mainId = (await warehouseOfKind(tx, A, 'MAIN')).id;
    await receiveStock(tx, { restaurantId: A, itemId: item, warehouseId: mainId, qtyBase: new D(100), unitCostIqd: new D(2000), ref: { type: 'T', id: '1' }, user: PARTNER });
    const shop = (await createCustomer(tx, A, { name: 'Shop', cityId: city.id })).id;
    await postSaleTx(tx, A, PARTNER, { customerId: shop, date: today, currency: 'IQD', paymentMode: 'CASH', warehouseId: mainId, lines: [{ itemId: item, unit: 'PIECE', qty: '10', mode: 'OFFICIAL' }] } as never);
  });
});

describe('assistant words', () => {
  it('chooses tools from the question in three languages, never from anything else', () => {
    expect(toolsFor('How much cash do we have?')).toEqual(['cash']);
    expect(toolsFor('كم الديون والأرباح؟')).toEqual(['debts', 'profit']);
    expect(toolsFor('قازانجی ئەم مانگە چەندە')).toEqual(['profit']);
    expect(toolsFor('hello there')).toEqual([]);
    expect(periodFor('sales today')).toBe('today');
    expect(periodFor('ربح هذا الأسبوع')).toBe('week');
    expect(periodFor('profit')).toBe('month');
  });
});

describe('assistant answers', () => {
  it('without a model, the tables answer from the books', async () => {
    setAiProviderForTests(null);
    const a = await ask('how much cash do we have');
    expect(a.degraded).toBe('NO_AI');
    expect(a.text).toBeNull();
    expect(a.tables[0].rows.find((r) => r.value.endsWith('IQD'))?.value).toBe('30,000 IQD');
    expect(a.used).toBe(0);
  });

  it('keeps the model phrasing when every figure is in the tables, and counts the question', async () => {
    const p = usesTool('cash', {}, 'You hold 30,000 IQD in the dinar box.');
    setAiProviderForTests(p);
    const a = await ask('how much cash do we have');
    expect(a.text).toBe('You hold 30,000 IQD in the dinar box.');
    expect(a.degraded).toBeUndefined();
    expect(a.used).toBe(1);
    expect(p.complete).toHaveBeenCalledTimes(2);
    expect(a.tables.length).toBeGreaterThan(0);
  });

  it('drops phrasing that holds a figure the tables do not', async () => {
    setAiProviderForTests(usesTool('cash', {}, 'You hold 45,000 IQD.'));
    const a = await ask('how much cash do we have');
    expect(a.text).toBeNull();
    expect(a.degraded).toBe('UNGROUNDED');
    expect(a.tables).toHaveLength(1);
  });

  it('a question about an item or about using the app goes to the model, which reads the books or teaches', async () => {
    const stock = usesTool('find_items', { query: 'rice' }, 'Rice: 90 PIECE in the main warehouse.');
    setAiProviderForTests(stock);
    const a = await ask('how many pieces of rice are left?');
    expect(a.degraded).toBeUndefined();
    expect(a.tables[0].rows.some((r) => r.value.startsWith('90'))).toBe(true);
    const how = reply('Open Stock, then Items, then New item. Fill the name and the unit.');
    setAiProviderForTests(how);
    const b = await ask('how do I add a new item?');
    expect(b.text).toContain('New item');
    expect(b.degraded).toBeUndefined();
  });

  it('a model that answers a book question without reading the books gets no say', async () => {
    setAiProviderForTests(reply('You hold 30,000 IQD.'));
    const a = await ask('how much cash do we have');
    expect(a.text).toBeNull();
    expect(a.degraded).toBe('UNGROUNDED');
    expect(a.tables.length).toBeGreaterThan(0);
  });

  it('gives the allowance back when the model fails, and stops at the limit', async () => {
    setAiProviderForTests({ name: 'fake', complete: vi.fn(async () => { throw new Error('down'); }) });
    const a = await ask('cash');
    expect(a.degraded).toBe('PROVIDER_ERROR');
    expect((await ask('cash')).used).toBe(0);
    const key = `aiUsage:${today.slice(0, 7)}`;
    await run((tx) => tx.whSetting.upsert({ where: { restaurantId_key: { restaurantId: A, key } }, create: { restaurantId: A, key, value: 300, updatedById: PARTNER.id }, update: { value: 300 } }));
    setAiProviderForTests(reply('x'));
    const b = await ask('cash');
    expect(b.degraded).toBe('LIMIT');
    expect(b.tables).toHaveLength(1);
  });
});
