import { z } from 'zod';
import { RATE_MAX, RATE_SETTING_KEY, type AccountCurrency, type AccountKind } from '@/lib/accounts';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

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
  /** An income whose money has not all been received: the client owes what the payments leave. */
  owed: boolean;
  /** Received so far, in this movement's own minor unit. */
  paidMinor: number;
  /** The payments received against it, oldest first. */
  payments: BookPayment[];
  /** The files kept with it (never their bytes: those come one at a time from the download link). */
  attachments: BookAttachment[];
}

export interface BookAttachment {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
}

export interface BookPayment {
  id: string;
  amountMinor: number;
  /** The calendar day, `YYYY-MM-DD`. */
  paidOn: string;
  note: string;
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
        include: {
          client: { select: { name: true } },
          payments: { where: { archivedAt: null }, orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }], select: { id: true, amountMinor: true, paidOn: true, note: true } },
          attachments: { where: { archivedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, fileName: true, mediaType: true, sizeBytes: true } },
        },
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
        owed: row.owed,
        paidMinor: row.payments.reduce((sum, payment) => sum + payment.amountMinor, 0),
        payments: row.payments.map((payment) => ({ id: payment.id, amountMinor: payment.amountMinor, paidOn: payment.paidOn.toISOString().slice(0, 10), note: payment.note })),
        attachments: row.attachments,
      })),
    };
  },
});

/** One attachment with its bytes, for the download link. */
export const accountAttachment = defineQuery({
  name: 'accounts.attachment',
  permission: 'platform.settings',
  input: z.object({ id: z.string().min(1).max(100) }),
  target: () => ({ kind: 'platform' }),
  run: async ({ db }, { id }) => {
    const row = await db.accountAttachment.findFirst({ where: { id, archivedAt: null }, select: { fileName: true, mediaType: true, data: true } });
    if (!row) throw new StudioError('NOT_FOUND');
    return { fileName: row.fileName, mediaType: row.mediaType, bytes: new Uint8Array(row.data) };
  },
});

export interface InvoiceData {
  number: number;
  issuedOn: string;
  occurredOn: string;
  currency: AccountCurrency;
  amountMinor: number;
  paidMinor: number;
  service: string;
  note: string;
  clientName: string | null;
  clientPhone: string;
  payments: BookPayment[];
}

/** Everything an invoice page shows, for an income that has been given its number. */
export const accountInvoice = defineQuery({
  name: 'accounts.invoice',
  permission: 'platform.settings',
  input: z.object({ entryId: z.string().min(1).max(100) }),
  target: () => ({ kind: 'platform' }),
  run: async ({ db }, { entryId }): Promise<InvoiceData> => {
    const row = await db.accountEntry.findFirst({
      where: { id: entryId, archivedAt: null, kind: 'INCOME', invoice: { isNot: null } },
      include: {
        invoice: { select: { number: true, issuedOn: true } },
        client: { select: { name: true, phone: true } },
        payments: { where: { archivedAt: null }, orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }], select: { id: true, amountMinor: true, paidOn: true, note: true } },
      },
    });
    if (!row?.invoice) throw new StudioError('NOT_FOUND');
    // An income that is not marked as owed was received in full.
    const paid = row.owed ? row.payments.reduce((sum, payment) => sum + payment.amountMinor, 0) : row.amountMinor;
    return {
      number: row.invoice.number,
      issuedOn: row.invoice.issuedOn.toISOString().slice(0, 10),
      occurredOn: row.occurredOn.toISOString().slice(0, 10),
      currency: row.currency,
      amountMinor: row.amountMinor,
      paidMinor: paid,
      service: row.service,
      note: row.note,
      clientName: row.client?.name ?? null,
      clientPhone: row.client?.phone ?? '',
      // Paid in full on the day it was typed in, unless it is marked as owed: then the payments received so far.
      payments: row.owed
        ? row.payments.map((payment) => ({ id: payment.id, amountMinor: payment.amountMinor, paidOn: payment.paidOn.toISOString().slice(0, 10), note: payment.note }))
        : [{ id: row.id, amountMinor: row.amountMinor, paidOn: row.occurredOn.toISOString().slice(0, 10), note: row.note }],
    };
  },
});
