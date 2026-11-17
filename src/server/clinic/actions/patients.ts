import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction, type ClContext } from '../framework';
import { isPhone, normalizePhone } from '../phone';

/**
 * The clinic's one patient file. Contact details only, and the audit rows say which file and never what is in it: a
 * patient's name, phone or birth year is not written to the audit log. The owner and the receptionist use it; a doctor
 * reaches a patient through a visit, and the one who takes payments through a bill (later plans).
 */

const ROLES = ['OWNER', 'RECEPTION'] as const;
const SEARCH_LIMIT = 50;

const phoneField = z
  .string()
  .max(40)
  .transform(normalizePhone)
  .refine(isPhone, 'Enter a valid phone number');

const patientFields = {
  name: z.string().trim().min(1, 'Enter the patient’s name').max(120),
  phone: phoneField,
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
};

/** The household of a phone number in this clinic, made when there is none yet. */
async function householdFor(ctx: ClContext, phone: string): Promise<string> {
  const found = await ctx.db.clHousehold.findFirst({ where: { phone } });
  if (found) return found.id;
  try {
    return (await ctx.db.clHousehold.create({ data: { restaurantId: ctx.restaurantId, phone } })).id;
  } catch (error) {
    // Two desks creating the same family at once: the other one won, use theirs.
    const again = await ctx.db.clHousehold.findFirst({ where: { phone } });
    if (again) return again.id;
    throw error;
  }
}

const summary = (p: { id: string; name: string; phone: string; birthYear: number | null }) => ({ patientId: p.id, name: p.name, phone: p.phone, birthYear: p.birthYear });

export const searchPatients = defineClAction({
  name: 'clinic.patients.search',
  roles: [...ROLES],
  input: z.object({ query: z.string().trim().max(80) }),
  run: async (ctx, { query }) => {
    const digits = normalizePhone(query);
    const or = [{ name: { contains: query, mode: 'insensitive' as const } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])];
    const rows = await ctx.db.clPatient.findMany({
      where: query === '' ? {} : { OR: or },
      orderBy: query === '' ? { createdAt: 'desc' } : { name: 'asc' },
      take: SEARCH_LIMIT,
    });
    return rows.map(summary);
  },
});

export const createPatient = defineClAction({
  name: 'clinic.patients.create',
  roles: [...ROLES],
  input: z.object(patientFields),
  run: async (ctx, { name, phone, birthYear }) => {
    const householdId = await householdFor(ctx, phone);
    const row = await ctx.db.clPatient.create({ data: { restaurantId: ctx.restaurantId, householdId, name, phone, birthYear: birthYear ?? null } });
    // The file's id only: a patient's details never enter the audit log.
    ctx.audit({ action: 'clinic.patient_created', entityType: 'ClPatient', entityId: row.id, changes: {} });
    return summary(row);
  },
});

export const getPatient = defineClAction({
  name: 'clinic.patients.get',
  roles: [...ROLES],
  input: z.object({ patientId: z.string().min(1).max(64) }),
  run: async (ctx, { patientId }) => {
    const row = await ctx.db.clPatient.findFirst({ where: { id: patientId } });
    if (!row) throw new StudioError('NOT_FOUND');
    const household = await ctx.db.clPatient.findMany({ where: { householdId: row.householdId }, orderBy: { createdAt: 'asc' } });
    return { ...summary(row), household: household.map(summary) };
  },
});

export const updatePatient = defineClAction({
  name: 'clinic.patients.update',
  roles: [...ROLES],
  input: z.object({ patientId: z.string().min(1).max(64), ...patientFields }),
  run: async (ctx, { patientId, name, phone, birthYear }) => {
    const row = await ctx.db.clPatient.findFirst({ where: { id: patientId } });
    if (!row) throw new StudioError('NOT_FOUND');
    const householdId = phone === row.phone ? row.householdId : await householdFor(ctx, phone);
    await ctx.db.clPatient.update({ where: { id: patientId }, data: { householdId, name, phone, birthYear: birthYear ?? null } });
    ctx.audit({ action: 'clinic.patient_updated', entityType: 'ClPatient', entityId: patientId, changes: {} });
    return null;
  },
});
