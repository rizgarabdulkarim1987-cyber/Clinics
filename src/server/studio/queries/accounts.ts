import { z } from 'zod';
import { RATE_MAX, RATE_SETTING_KEY, type AccountCurrency, type AccountKind } from '@/lib/accounts';
import { defineQuery } from '@/server/studio/framework/query';

/** The most movements the screen holds at once: far beyond a side business, and a guard for the page's size. */
export const BOOK_LIMIT = 20_000;

export interface BookClient {
  id: string;
  name: string;
  slug: string;
  phone: string;
}

export interface BookMovement {
  id: string;
  kind: AccountKind;
  amountMinor: number;
  currency: AccountCurrency;
  clientId: string | null;
  /** The client's name, kept even after the client is archived; null for a movement with no client. */
  clientName: string | null;
  service: string;
  note: string;
  /** The calendar day, `YYYY-MM-DD`. */
  occurredOn: string;
  /** When it was typed in, as an ISO time. */
  recordedAt: string;
  /** Whole dinars for one dollar on the day it was typed in; null when no rate had been set yet. */
  rate: number | null;
}

export interface AccountsBook {
  clients: BookClient[];
  /** Newest day first. Totals are worked out from these in the browser and in the Excel file, by `@/lib/accounts`. */
  movements: BookMovement[];
  /** Whole dinars for one dollar, or null while none has been typed. */
  rate: number | null;
}

/** Everything the accounts screen shows, in one read: the active clients and every movement not archived. */
export const accountsBook = defineQuery({
  name: 'accounts.book',
  permission: 'platform.settings',
  input: z.unknown(),
  target: () => ({ kind: 'platform' }),
  run: async ({ db }): Promise<AccountsBook> => {
    const [clients, rows, setting] = await Promise.all([
      db.accountClient.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, phone: true } }),
      db.accountEntry.findMany({
        where: { archivedAt: null },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        take: BOOK_LIMIT,
        include: { client: { select: { name: true } } },
      }),
      db.platformSetting.findUnique({ where: { key: RATE_SETTING_KEY }, select: { value: true } }),
    ]);
    const stored = setting?.value;
    return {
      rate: typeof stored === 'number' && Number.isInteger(stored) && stored >= 1 && stored <= RATE_MAX ? stored : null,
      clients,
      movements: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        amountMinor: row.amountMinor,
        currency: row.currency,
        clientId: row.clientId,
        clientName: row.client?.name ?? null,
        service: row.service,
        note: row.note,
        occurredOn: row.occurredOn.toISOString().slice(0, 10),
        recordedAt: row.createdAt.toISOString(),
        rate: row.rate,
      })),
    };
  },
});
