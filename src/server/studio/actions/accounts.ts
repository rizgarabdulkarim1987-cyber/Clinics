import { z } from 'zod';
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_ENTRY, cleanAttachmentName, sniffAttachment } from '@/lib/attachments';
import { nextSlug, parsePeriod, parseRate, RATE_SETTING_KEY, slugFromName } from '@/lib/accounts';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { parseAmountInput, type AmountInputProblem } from '@/studio/money-input';

/**
 * The agency's simple books (docs/superpowers/specs/2026-11-09-agency-accounts-design.md): clients and the money that
 * came in or went out. Only Super Admins hold `platform.settings`. Nothing is hard-deleted: a mistake is archived, and
 * every change is in the audit log.
 */

const PLATFORM = { kind: 'platform' } as const;

const AMOUNT_MESSAGES: Record<AmountInputProblem, string> = {
  EMPTY: 'Type an amount',
  NOT_A_NUMBER: 'Use digits only, for example 150000 or 19.99',
  NEGATIVE: 'Type the amount without a minus: income or expense says which way it goes',
  NOT_WHOLE: 'Dinars have no fractions: type 25000 or 25,000',
  TOO_PRECISE: 'Dollars take at most two digits after the point',
  TOO_LARGE: 'That amount is too large',
};

/** Today's date in Baghdad, as `YYYY-MM-DD`. */
function todayInBaghdad(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());
}

/** A `YYYY-MM-DD` that is a real calendar day, as the date the database stores. */
function toDay(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export const createAccountClient = defineAction({
  name: 'account.client.create',
  permission: 'platform.settings',
  input: z.object({
    name: z.string().trim().min(1, 'Type the name of the client').max(120, 'Use at most 120 characters'),
    /** Optional: the slug the person edited. Made from the name when empty. */
    slug: z.string().max(80).optional(),
    phone: z.string().trim().max(60, 'Use at most 60 characters').optional(),
  }),
  target: () => PLATFORM,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const taken = new Set((await tx.accountClient.findMany({ select: { slug: true } })).map((row) => row.slug));
      const wanted = slugFromName(input.slug ?? '') || slugFromName(input.name);
      const slug = nextSlug(wanted, taken);
      const row = await tx.accountClient.create({
        data: { name: input.name, slug, phone: input.phone ?? '', createdById: ctx.actor.userId },
        select: { id: true, slug: true },
      });
      ctx.audit({ action: 'account.client.created', entityType: 'AccountClient', entityId: row.id });
      return { id: row.id, slug: row.slug };
    }),
});

export const archiveAccountClient = defineAction({
  name: 'account.client.archive',
  permission: 'platform.settings',
  input: z.object({ id: z.string().min(1).max(100) }),
  target: () => PLATFORM,
  run: (ctx, { id }) =>
    ctx.transaction(async (tx) => {
      const found = await tx.accountClient.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
      if (!found) throw new StudioError('NOT_FOUND');
      await tx.accountClient.update({ where: { id }, data: { archivedAt: new Date() } });
      ctx.audit({ action: 'account.client.archived', entityType: 'AccountClient', entityId: id });
      return { id };
    }),
});

export const addAccountEntry = defineAction({
  name: 'account.entry.create',
  permission: 'platform.settings',
  input: z.object({
    kind: z.enum(['INCOME', 'EXPENSE']),
    /** As typed, in the major unit: `1,500,000` dinars or `19.99` dollars. */
    amount: z.string().max(40),
    currency: z.enum(['IQD', 'USD']),
    clientId: z.string().min(1).max(100).nullable().optional(),
    service: z.string().trim().max(60, 'Use at most 60 characters').optional(),
    note: z.string().trim().max(120, 'Use at most 120 characters').optional(),
    /** `YYYY-MM-DD`; today (Baghdad) when left out. */
    occurredOn: z.string().max(10).optional(),
    /** An income whose money has not been received yet. Ignored on an expense. */
    owed: z.boolean().optional(),
  }),
  target: () => PLATFORM,
  run: (ctx, input) => {
    const amount = parseAmountInput(input.amount, input.currency);
    if (!amount.ok) throw new StudioError('INVALID', undefined, { amount: AMOUNT_MESSAGES[amount.reason] });
    if (amount.minor <= 0) throw new StudioError('INVALID', undefined, { amount: 'The amount must be more than zero' });
    const day = toDay(input.occurredOn || todayInBaghdad());
    if (!day) throw new StudioError('INVALID', undefined, { occurredOn: 'Use a real date' });

    return ctx.transaction(async (tx) => {
      if (input.clientId) {
        const client = await tx.accountClient.findFirst({ where: { id: input.clientId, archivedAt: null }, select: { id: true } });
        if (!client) throw new StudioError('NOT_FOUND');
      }
      // The rate of the day it is typed in stays with it: a later rate never changes it.
      const setting = await tx.platformSetting.findUnique({ where: { key: RATE_SETTING_KEY }, select: { value: true } });
      const stored = setting?.value;
      const rate = typeof stored === 'number' && Number.isInteger(stored) && stored >= 1 ? stored : null;
      const row = await tx.accountEntry.create({
        data: {
          rate,
          owed: input.kind === 'INCOME' && input.owed === true,
          kind: input.kind,
          amountMinor: amount.minor,
          currency: input.currency,
          clientId: input.clientId ?? null,
          service: input.service ?? '',
          note: input.note ?? '',
          occurredOn: day,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      ctx.audit({ action: 'account.entry.created', entityType: 'AccountEntry', entityId: row.id });
      return { id: row.id };
    });
  },
});

export const updateAccountEntry = defineAction({
  name: 'account.entry.update',
  permission: 'platform.settings',
  input: z.object({
    id: z.string().min(1).max(100),
    kind: z.enum(['INCOME', 'EXPENSE']),
    amount: z.string().max(40),
    currency: z.enum(['IQD', 'USD']),
    clientId: z.string().min(1).max(100).nullable().optional(),
    service: z.string().trim().max(60, 'Use at most 60 characters').optional(),
    note: z.string().trim().max(120, 'Use at most 120 characters').optional(),
    occurredOn: z.string().max(10).optional(),
    /** Left out, the entry keeps whether it is owed; an expense is never owed. */
    owed: z.boolean().optional(),
  }),
  target: () => PLATFORM,
  run: (ctx, input) => {
    const amount = parseAmountInput(input.amount, input.currency);
    if (!amount.ok) throw new StudioError('INVALID', undefined, { amount: AMOUNT_MESSAGES[amount.reason] });
    if (amount.minor <= 0) throw new StudioError('INVALID', undefined, { amount: 'The amount must be more than zero' });
    const day = toDay(input.occurredOn || todayInBaghdad());
    if (!day) throw new StudioError('INVALID', undefined, { occurredOn: 'Use a real date' });

    return ctx.transaction(async (tx) => {
      const found = await tx.accountEntry.findFirst({ where: { id: input.id, archivedAt: null }, select: { id: true, owed: true } });
      if (!found) throw new StudioError('NOT_FOUND');
      if (input.clientId) {
        const client = await tx.accountClient.findFirst({ where: { id: input.clientId, archivedAt: null }, select: { id: true } });
        if (!client) throw new StudioError('NOT_FOUND');
      }
      // The rate stays the one of the day it was first typed in: a correction is not a new entry.
      await tx.accountEntry.update({
        where: { id: input.id },
        data: {
          kind: input.kind,
          amountMinor: amount.minor,
          currency: input.currency,
          clientId: input.clientId ?? null,
          service: input.service ?? '',
          note: input.note ?? '',
          occurredOn: day,
          owed: input.kind === 'INCOME' && (input.owed ?? found.owed),
        },
      });
      ctx.audit({ action: 'account.entry.updated', entityType: 'AccountEntry', entityId: input.id });
      return { id: input.id };
    });
  },
});

export const archiveAccountEntry = defineAction({
  name: 'account.entry.archive',
  permission: 'platform.settings',
  input: z.object({ id: z.string().min(1).max(100) }),
  target: () => PLATFORM,
  run: (ctx, { id }) =>
    ctx.transaction(async (tx) => {
      const found = await tx.accountEntry.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
      if (!found) throw new StudioError('NOT_FOUND');
      await tx.accountEntry.update({ where: { id }, data: { archivedAt: new Date() } });
      ctx.audit({ action: 'account.entry.archived', entityType: 'AccountEntry', entityId: id });
      return { id };
    }),
});

export const addAccountPayment = defineAction({
  name: 'account.payment.create',
  permission: 'platform.settings',
  input: z.object({
    entryId: z.string().min(1).max(100),
    /** As typed, in the major unit of the entry's own currency. */
    amount: z.string().max(40),
    /** `YYYY-MM-DD`; today (Baghdad) when left out. */
    paidOn: z.string().max(10).optional(),
    note: z.string().trim().max(120, 'Use at most 120 characters').optional(),
  }),
  target: () => PLATFORM,
  run: (ctx, input) => {
    const day = toDay(input.paidOn || todayInBaghdad());
    if (!day) throw new StudioError('INVALID', undefined, { paidOn: 'Use a real date' });
    return ctx.transaction(async (tx) => {
      const entry = await tx.accountEntry.findFirst({
        where: { id: input.entryId, archivedAt: null, kind: 'INCOME', owed: true },
        select: { id: true, amountMinor: true, currency: true },
      });
      if (!entry) throw new StudioError('NOT_FOUND');
      const amount = parseAmountInput(input.amount, entry.currency);
      if (!amount.ok) throw new StudioError('INVALID', undefined, { amount: AMOUNT_MESSAGES[amount.reason] });
      if (amount.minor <= 0) throw new StudioError('INVALID', undefined, { amount: 'The amount must be more than zero' });
      const paid = await tx.accountPayment.aggregate({ where: { entryId: entry.id, archivedAt: null }, _sum: { amountMinor: true } });
      if (amount.minor > entry.amountMinor - (paid._sum.amountMinor ?? 0)) {
        throw new StudioError('INVALID', undefined, { amount: 'That is more than what is left to receive' });
      }
      const row = await tx.accountPayment.create({
        data: { entryId: entry.id, amountMinor: amount.minor, paidOn: day, note: input.note ?? '', createdById: ctx.actor.userId },
        select: { id: true },
      });
      ctx.audit({ action: 'account.payment.created', entityType: 'AccountPayment', entityId: row.id });
      return { id: row.id };
    });
  },
});

export const archiveAccountPayment = defineAction({
  name: 'account.payment.archive',
  permission: 'platform.settings',
  input: z.object({ id: z.string().min(1).max(100) }),
  target: () => PLATFORM,
  run: (ctx, { id }) =>
    ctx.transaction(async (tx) => {
      const found = await tx.accountPayment.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
      if (!found) throw new StudioError('NOT_FOUND');
      await tx.accountPayment.update({ where: { id }, data: { archivedAt: new Date() } });
      ctx.audit({ action: 'account.payment.archived', entityType: 'AccountPayment', entityId: id });
      return { id };
    }),
});

export const setAccountRate = defineAction({
  name: 'account.rate.set',
  permission: 'platform.settings',
  input: z.object({ rate: z.string().max(20) }),
  target: () => PLATFORM,
  run: (ctx, input) => {
    const parsed = parseRate(input.rate);
    if (!parsed.ok) throw new StudioError('INVALID', undefined, { rate: 'Type the dinars for one dollar, for example 1500' });
    return ctx.transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: RATE_SETTING_KEY },
        create: { key: RATE_SETTING_KEY, value: parsed.rate, updatedById: ctx.actor.userId },
        update: { value: parsed.rate, updatedById: ctx.actor.userId },
      });
      ctx.audit({ action: 'account.rate.set', entityType: 'PlatformSetting', entityId: RATE_SETTING_KEY });
      return { rate: parsed.rate };
    });
  },
});

export const addAccountAttachment = defineAction({
  name: 'account.attachment.create',
  permission: 'platform.settings',
  input: z.object({
    entryId: z.string().min(1).max(100),
    fileName: z.string().max(300),
    data: z.instanceof(Uint8Array),
  }),
  target: () => PLATFORM,
  run: (ctx, input) => {
    if (input.data.byteLength === 0) throw new StudioError('INVALID', undefined, { file: 'That file is empty' });
    if (input.data.byteLength > ATTACHMENT_MAX_BYTES) throw new StudioError('INVALID', undefined, { file: 'A file can be at most 5 MB' });
    const type = sniffAttachment(input.data);
    if (!type) throw new StudioError('INVALID', undefined, { file: 'Use a photo (PNG, JPG, WebP) or a PDF' });
    return ctx.transaction(async (tx) => {
      const entry = await tx.accountEntry.findFirst({ where: { id: input.entryId, archivedAt: null }, select: { id: true } });
      if (!entry) throw new StudioError('NOT_FOUND');
      const count = await tx.accountAttachment.count({ where: { entryId: entry.id, archivedAt: null } });
      if (count >= ATTACHMENTS_PER_ENTRY) throw new StudioError('INVALID', undefined, { file: 'An entry can hold at most 10 files' });
      const row = await tx.accountAttachment.create({
        data: { entryId: entry.id, fileName: cleanAttachmentName(input.fileName, type), mediaType: type, sizeBytes: input.data.byteLength, data: Buffer.from(input.data), createdById: ctx.actor.userId },
        select: { id: true },
      });
      ctx.audit({ action: 'account.attachment.created', entityType: 'AccountAttachment', entityId: row.id });
      return { id: row.id };
    });
  },
});

export const archiveAccountAttachment = defineAction({
  name: 'account.attachment.archive',
  permission: 'platform.settings',
  input: z.object({ id: z.string().min(1).max(100) }),
  target: () => PLATFORM,
  run: (ctx, { id }) =>
    ctx.transaction(async (tx) => {
      const found = await tx.accountAttachment.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
      if (!found) throw new StudioError('NOT_FOUND');
      await tx.accountAttachment.update({ where: { id }, data: { archivedAt: new Date() } });
      ctx.audit({ action: 'account.attachment.archived', entityType: 'AccountAttachment', entityId: id });
      return { id };
    }),
});

/** Gives an income its invoice number the first time it is asked for; asking again returns the same one. */
export const issueAccountInvoice = defineAction({
  name: 'account.invoice.issue',
  permission: 'platform.settings',
  input: z.object({ entryId: z.string().min(1).max(100) }),
  target: () => PLATFORM,
  run: (ctx, { entryId }) =>
    ctx.transaction(async (tx) => {
      const entry = await tx.accountEntry.findFirst({ where: { id: entryId, archivedAt: null, kind: 'INCOME' }, select: { id: true, invoice: { select: { number: true } } } });
      if (!entry) throw new StudioError('NOT_FOUND');
      if (entry.invoice) return { number: entry.invoice.number };
      const row = await tx.accountInvoice.create({ data: { entryId: entry.id, issuedOn: toDay(todayInBaghdad())!, createdById: ctx.actor.userId }, select: { id: true, number: true } });
      ctx.audit({ action: 'account.invoice.issued', entityType: 'AccountInvoice', entityId: row.id });
      return { number: row.number };
    }),
});

/** Gives one client's invoice for a period its number the first time it is asked for; asking again returns the same one. */
export const issueAccountClientInvoice = defineAction({
  name: 'account.clientInvoice.issue',
  permission: 'platform.settings',
  input: z.object({ clientId: z.string().min(1).max(100), period: z.string().max(20) }),
  target: () => PLATFORM,
  run: (ctx, { clientId, period }) =>
    ctx.transaction(async (tx) => {
      if (!parsePeriod(period)) throw new StudioError('INVALID');
      const client = await tx.accountClient.findFirst({ where: { id: clientId, archivedAt: null }, select: { id: true } });
      if (!client) throw new StudioError('NOT_FOUND');
      const known = await tx.accountClientInvoice.findUnique({ where: { clientId_period: { clientId, period } }, select: { number: true } });
      if (known) return { number: known.number };
      const row = await tx.accountClientInvoice.create({ data: { clientId, period, issuedOn: toDay(todayInBaghdad())!, createdById: ctx.actor.userId }, select: { id: true, number: true } });
      ctx.audit({ action: 'account.clientInvoice.issued', entityType: 'AccountClientInvoice', entityId: row.id });
      return { number: row.number };
    }),
});
