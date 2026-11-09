import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAiProviderForTests } from '@/server/ai/provider';
import type { AiProvider } from '@/server/ai/provider/types';
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { assistantUsed } from '@/server/wholesale/assistant';
import { createItem } from '@/server/wholesale/catalog';
import { checkReading, matchItem, numberText, readInvoicePhoto, type CatalogItem } from '@/server/wholesale/photoEntry';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

/** Photo entry: the model reads, the code cleans, matches and adds up; nothing is written to the books. */

const items: CatalogItem[] = [
  { id: 'i1', code: 'SUGAR-1', names: { en: 'Sugar 1 kg', ar: 'سكر 1 كغم', ckb: 'شەکر ١ کیلۆ' } },
  { id: 'i2', code: 'FLOUR-5', names: { en: 'Flour 5 kg', ar: 'طحين 5 كغم', ckb: 'ئارد ٥ کیلۆ' } },
];

describe('numberText', () => {
  it('reads printed numbers and refuses anything else', () => {
    expect(numberText('1,250')).toBe('1250');
    expect(numberText('١٢٥٠')).toBe('1250');
    expect(numberText('12.5 USD')).toBe('12.5');
    expect(numberText('abc')).toBeNull();
    expect(numberText('0')).toBeNull();
    expect(numberText(null)).toBeNull();
  });
});

describe('matchItem', () => {
  it('matches by code, by exact name and by most shared words, and leaves a stranger unmatched', () => {
    expect(matchItem('whatever', 'sugar-1', items)?.id).toBe('i1');
    expect(matchItem('سكر 1 كغم', null, items)?.id).toBe('i1');
    expect(matchItem('Flour 5 kg white', null, items)?.id).toBe('i2');
    expect(matchItem('Motor oil', null, items)).toBeNull();
  });
});

describe('checkReading', () => {
  it('works the line total out in code, never trusts the model for it', () => {
    const out = checkReading({ party: ' Acme ', currency: 'usd', lines: [{ name: 'Sugar 1 kg', code: null, qty: '10', unitPrice: '2.5' }, { name: '', code: null, qty: '1', unitPrice: '1' }, { name: 'Unknown', code: null, qty: 'x', unitPrice: null }] }, items, 'en');
    expect(out.currency).toBe('USD');
    expect(out.party).toBe('Acme');
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0]).toMatchObject({ itemId: 'i1', total: '25' });
    expect(out.lines[1]).toMatchObject({ itemId: null, qty: null, total: null });
  });
});

describe('readInvoicePhoto', () => {
  const prisma = () => getPrisma();
  let A: string;
  const run = <T>(fn: (tx: Parameters<Parameters<ReturnType<typeof scopedClient>['$transaction']>[0]>[0]) => Promise<T>) => scopedClient(prisma(), { restaurantId: A }).$transaction(fn);
  const photo = { mediaType: 'image/jpeg', base64: 'A'.repeat(200) };
  const answer = (obj: unknown): AiProvider => ({ name: 'fake', complete: vi.fn(async () => ({ stop: 'end' as const, content: [{ type: 'text' as const, text: JSON.stringify(obj) }], model: 'x', inputTokens: 1, outputTokens: 1 })) });

  beforeAll(() => {
    requireTestDb();
    vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  });
  afterEach(() => setAiProviderForTests(undefined));
  beforeEach(async () => {
    await resetTestData(prisma());
    A = (await prisma().restaurant.create({ data: { name: 'Company A', sector: 'WHOLESALE' } })).id;
    await prisma().user.create({ data: { id: 'u1', name: 'p', email: 'p@example.com' } });
    await run((tx) => createItem(tx, A, { code: 'SUGAR-1', names: { en: 'Sugar 1 kg', ar: 'سكر 1 كغم', ckb: 'شەکر' }, baseUnit: 'PIECE', units: [{ unit: 'PIECE', factorToBase: '1' }] }));
  });
  const env = () => ({ rid: A, user: { id: 'u1' }, locale: 'en' as const });

  it('reads, matches against the real catalogue and counts one use', async () => {
    setAiProviderForTests(answer({ party: 'Acme', currency: 'IQD', lines: [{ name: 'Sugar 1 kg', code: null, qty: '4', unitPrice: '900' }] }));
    const r = await readInvoicePhoto(run, env(), photo);
    expect(r.degraded).toBeUndefined();
    expect(r.lines[0]).toMatchObject({ total: '3600' });
    expect(r.lines[0]!.itemId).not.toBeNull();
    expect(await run(assistantUsed)).toBe(1);
  });

  it('gives the allowance back when the model is down, and says so', async () => {
    setAiProviderForTests({ name: 'fake', complete: vi.fn(async () => { throw new Error('down'); }) });
    const r = await readInvoicePhoto(run, env(), photo);
    expect(r.degraded).toBe('PROVIDER_ERROR');
    expect(await run(assistantUsed)).toBe(0);
  });

  it('reports an unreadable photo when no line comes back, and rejects a wrong file type', async () => {
    setAiProviderForTests(answer({ party: null, currency: null, lines: [] }));
    expect((await readInvoicePhoto(run, env(), photo)).degraded).toBe('UNREADABLE');
    await expect(readInvoicePhoto(run, env(), { mediaType: 'application/pdf', base64: 'A'.repeat(200) })).rejects.toThrow();
  });
});
