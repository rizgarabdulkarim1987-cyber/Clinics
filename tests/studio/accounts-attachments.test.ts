import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addAccountAttachment, addAccountEntry, archiveAccountAttachment } from '@/server/studio/actions/accounts';
import { accountAttachment, accountsBook } from '@/server/studio/queries/accounts';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let admin: Person;
let cashier: Person;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);

beforeAll(() => useTestDatabase());
beforeEach(async () => {
  await resetWorld();
  const r = await restaurant('Attach A');
  admin = await person('admin', { superAdmin: true });
  cashier = await person('cashier', { staff: [r.id, 'CASHIER'] });
});
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const entry = async () => dataOf(await run(admin, addAccountEntry, { kind: 'INCOME', amount: '1000', currency: 'IQD', occurredOn: '2026-11-01' })).id as string;
const attach = (entryId: string, over: Record<string, unknown> = {}) => run(admin, addAccountAttachment, { entryId, fileName: 'invoice.pdf', data: PDF, ...over });

describe('attachments on an entry', () => {
  it('keeps a file with the entry, lists it without its bytes, and serves it back', async () => {
    const id = await entry();
    const { id: fileId } = dataOf(await attach(id, { fileName: '..\\x/invoice 7.exe' }));
    const row = dataOf(await ask(admin, accountsBook, {})).movements[0]!;
    expect(row.attachments).toEqual([{ id: fileId, fileName: 'invoice 7.pdf', mediaType: 'application/pdf', sizeBytes: PDF.byteLength }]);
    const file = dataOf(await ask(admin, accountAttachment, { id: fileId }));
    expect(file.mediaType).toBe('application/pdf');
    expect([...file.bytes]).toEqual([...PDF]);
    expect(await prisma().auditLog.count({ where: { action: 'account.attachment.created' } })).toBe(1);
  });

  it('refuses what is not a photo or a PDF, an empty file, a big one, and an eleventh', async () => {
    const id = await entry();
    expect(failureOf(await attach(id, { data: new TextEncoder().encode('<script>1</script>') })).fields?.file).toBe('Use a photo (PNG, JPG, WebP) or a PDF');
    expect(failureOf(await attach(id, { data: new Uint8Array() })).fields?.file).toBe('That file is empty');
    expect(failureOf(await attach(id, { data: new Uint8Array(5 * 1024 * 1024 + 1).fill(0x25) })).fields?.file).toBeDefined();
    for (let n = 0; n < 10; n += 1) dataOf(await attach(id));
    expect(failureOf(await attach(id)).fields?.file).toBe('An entry can hold at most 10 files');
  });

  it('removes a file from the list but keeps the row, and refuses anyone else', async () => {
    const id = await entry();
    const { id: fileId } = dataOf(await attach(id));
    expect(codeOf(await run(cashier, addAccountAttachment, { entryId: id, fileName: 'a.pdf', data: PDF }))).toBe('FORBIDDEN');
    expect(codeOf(await run(cashier, archiveAccountAttachment, { id: fileId }))).toBe('FORBIDDEN');
    expect(codeOf(await attach('nope'))).toBe('NOT_FOUND');
    dataOf(await run(admin, archiveAccountAttachment, { id: fileId }));
    expect(dataOf(await ask(admin, accountsBook, {})).movements[0]!.attachments).toEqual([]);
    expect(await prisma().accountAttachment.count()).toBe(1);
    expect(codeOf(await ask(admin, accountAttachment, { id: fileId }))).toBe('NOT_FOUND');
  });
});
