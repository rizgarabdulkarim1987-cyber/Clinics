import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction, type ClContext } from '../framework';

/**
 * Photos and documents of one patient. They are kept in the database and read only through these actions, so every
 * read is a signed-in member of this clinic who may see them. A clinic's files are clinical: doctors only. A beauty
 * centre keeps before and after photos, so its specialists, desk and owner may too. The type is read from the file's
 * first bytes, never from its name or the type the browser claims; size and count are limited; the name is made plain.
 * An audit row names the file by id and never carries content.
 */

const idField = z.string().min(1).max(64);
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_FILES = 30;
const MAX_NAME = 80;

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
};

function assertAllowed(ctx: ClContext): void {
  const beauty = ctx.account.space === 'BEAUTY';
  const allowed = beauty ? ['DOCTOR', 'RECEPTION', 'OWNER'] : ['DOCTOR'];
  if (!allowed.includes(ctx.member.role)) throw new StudioError('FORBIDDEN');
}

const plainName = (name: string): string => {
  const last = name.split(/[\\/]/).pop() ?? '';
  const cleaned = last.replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return cleaned === '' ? 'file' : cleaned;
};

/** A clinic's files are clinical, so they follow the same rule as visit notes: a doctor sees only what they saved unless the clinic shares notes. A beauty centre shares them across its team. */
async function readFilter(ctx: ClContext): Promise<{ uploadedById?: string }> {
  if (ctx.account.space === 'BEAUTY') return {};
  const shared = (await ctx.db.clSettings.findFirst({}))?.sharePrivateNotes ?? false;
  return shared ? {} : { uploadedById: ctx.member.memberId };
}

const ALL = ['OWNER', 'RECEPTION', 'DOCTOR', 'CASHIER'] as const;

export const listFiles = defineClAction({
  name: 'clinic.patientFiles.list',
  roles: [...ALL],
  input: z.object({ patientId: idField }),
  run: async (ctx, { patientId }) => {
    assertAllowed(ctx);
    const rows = await ctx.db.clPatientFile.findMany({ where: { patientId, ...(await readFilter(ctx)) }, select: { id: true, name: true, mime: true, bytes: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: MAX_FILES });
    return rows.map((f) => ({ fileId: f.id, name: f.name, mime: f.mime, bytes: f.bytes, createdAt: f.createdAt.toISOString() }));
  },
});

export const saveFile = defineClAction({
  name: 'clinic.patientFiles.save',
  roles: [...ALL],
  input: z.object({ patientId: idField, name: z.string().max(200), mime: z.string().max(60), data: z.string().max(Math.ceil((MAX_BYTES * 4) / 3) + 64) }),
  run: async (ctx, { patientId, name, mime, data }) => {
    assertAllowed(ctx);
    const patient = await ctx.db.clPatient.findFirst({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new StudioError('NOT_FOUND');
    const check = SIGNATURES[mime];
    if (!check) throw new StudioError('INVALID', 'This kind of file is not accepted');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new StudioError('INVALID', 'The file is empty or over 3 MB');
    if (!check(bytes)) throw new StudioError('INVALID', 'The file is not of the kind it says');
    if ((await ctx.db.clPatientFile.count({ where: { patientId } })) >= MAX_FILES) throw new StudioError('INVALID', 'This patient already has the most files allowed');
    const row = await ctx.db.clPatientFile.create({ data: { restaurantId: ctx.restaurantId, patientId, name: plainName(name), mime, bytes: bytes.length, data: bytes, uploadedById: ctx.member.memberId } });
    ctx.audit({ action: 'clinic.file_saved', entityType: 'ClPatientFile', entityId: row.id, changes: {} });
    return { fileId: row.id };
  },
});

export const readFile = defineClAction({
  name: 'clinic.patientFiles.read',
  roles: [...ALL],
  input: z.object({ fileId: idField }),
  run: async (ctx, { fileId }) => {
    assertAllowed(ctx);
    const row = await ctx.db.clPatientFile.findFirst({ where: { id: fileId, ...(await readFilter(ctx)) } });
    if (!row) throw new StudioError('NOT_FOUND');
    ctx.audit({ action: 'clinic.file_read', entityType: 'ClPatientFile', entityId: row.id, changes: {} });
    return { name: row.name, mime: row.mime, data: Buffer.from(row.data).toString('base64') };
  },
});

export const deleteFile = defineClAction({
  name: 'clinic.patientFiles.delete',
  roles: [...ALL],
  input: z.object({ fileId: idField }),
  run: async (ctx, { fileId }) => {
    assertAllowed(ctx);
    const { count } = await ctx.db.clPatientFile.deleteMany({ where: { id: fileId, ...(ctx.member.role === 'OWNER' ? {} : { uploadedById: ctx.member.memberId }) } });
    if (count === 0) throw new StudioError('NOT_FOUND');
    ctx.audit({ action: 'clinic.file_deleted', entityType: 'ClPatientFile', entityId: fileId, changes: {} });
    return null;
  },
});
