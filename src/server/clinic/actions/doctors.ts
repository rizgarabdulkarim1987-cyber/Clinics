import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { defineClAction, type ClContext } from '../framework';

/**
 * Doctors: a profile (speciality, whether they take patients), a working week and a fee list. A doctor is a person of
 * the clinic whose role is DOCTOR; their profile row is made the first time the owner saves anything for them, so a new
 * doctor is already listed. The owner edits; the receptionist reads, to book and route.
 */

const MAX_BLOCKS = 28;
const MAX_FEES = 40;
const MAX_FEE = 1_000_000_000;

const memberField = z.string().min(1).max(64);

const block = z
  .object({ weekday: z.number().int().min(0).max(6), startMin: z.number().int().min(0).max(1440), endMin: z.number().int().min(0).max(1440) })
  .refine((b) => b.startMin < b.endMin, 'A block must end after it starts');

const fee = z.object({ label: z.string().trim().min(1, 'Enter the fee’s name').max(80), amount: z.number().int().min(0).max(MAX_FEE) });

/** The doctor profile of a person of this clinic with the role DOCTOR, made when it does not exist yet. */
async function doctorOf(ctx: ClContext, memberId: string) {
  const member = await ctx.db.clMember.findFirst({ where: { id: memberId, role: 'DOCTOR' } });
  if (!member) throw new StudioError('NOT_FOUND');
  return (await ctx.db.clDoctor.findFirst({ where: { memberId } })) ?? (await ctx.db.clDoctor.create({ data: { restaurantId: ctx.restaurantId, memberId } }));
}

export const listDoctors = defineClAction({
  name: 'clinic.doctors.list',
  roles: ['OWNER', 'RECEPTION'],
  input: z.object({}),
  run: async (ctx) => {
    const members = await ctx.db.clMember.findMany({
      where: { role: 'DOCTOR', status: 'ACTIVE' },
      include: { account: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const profiles = await ctx.db.clDoctor.findMany({
      include: { hours: { orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }] }, fees: { orderBy: { sortOrder: 'asc' } } },
    });
    const byMember = new Map(profiles.map((p) => [p.memberId, p]));
    return members.map((m) => {
      const profile = byMember.get(m.id);
      return {
        memberId: m.id,
        name: m.account.name,
        speciality: profile?.speciality ?? '',
        active: profile?.active ?? true,
        hours: (profile?.hours ?? []).map((h) => ({ weekday: h.weekday, startMin: h.startMin, endMin: h.endMin })),
        fees: (profile?.fees ?? []).map((f) => ({ label: f.label, amount: f.amount })),
      };
    });
  },
});

export const saveDoctorProfile = defineClAction({
  name: 'clinic.doctors.saveProfile',
  roles: ['OWNER'],
  input: z.object({ memberId: memberField, speciality: z.string().trim().max(80), active: z.boolean() }),
  run: async (ctx, { memberId, speciality, active }) => {
    const doctor = await doctorOf(ctx, memberId);
    await ctx.db.clDoctor.update({ where: { id: doctor.id }, data: { speciality, active } });
    ctx.audit({
      action: 'clinic.doctor_profile_saved',
      entityType: 'ClDoctor',
      entityId: doctor.id,
      changes: { speciality: { before: doctor.speciality, after: speciality }, active: { before: doctor.active, after: active } },
    });
    return null;
  },
});

export const saveDoctorHours = defineClAction({
  name: 'clinic.doctors.saveHours',
  roles: ['OWNER'],
  input: z
    .object({ memberId: memberField, blocks: z.array(block).max(MAX_BLOCKS) })
    .refine((input) => !overlaps(input.blocks), { message: 'Two blocks of one day overlap', path: ['blocks'] }),
  run: async (ctx, { memberId, blocks }) => {
    const doctor = await doctorOf(ctx, memberId);
    const before = await ctx.db.clDoctorHours.count({ where: { doctorId: doctor.id } });
    await ctx.db.clDoctorHours.deleteMany({ where: { doctorId: doctor.id } });
    if (blocks.length > 0) await ctx.db.clDoctorHours.createMany({ data: blocks.map((b) => ({ restaurantId: ctx.restaurantId, doctorId: doctor.id, ...b })) });
    ctx.audit({ action: 'clinic.doctor_hours_saved', entityType: 'ClDoctor', entityId: doctor.id, changes: { blocks: { before, after: blocks.length } } });
    return null;
  },
});

export const saveDoctorFees = defineClAction({
  name: 'clinic.doctors.saveFees',
  roles: ['OWNER'],
  input: z.object({ memberId: memberField, fees: z.array(fee).max(MAX_FEES) }),
  run: async (ctx, { memberId, fees }) => {
    const doctor = await doctorOf(ctx, memberId);
    const before = await ctx.db.clDoctorFee.count({ where: { doctorId: doctor.id } });
    await ctx.db.clDoctorFee.deleteMany({ where: { doctorId: doctor.id } });
    if (fees.length > 0) await ctx.db.clDoctorFee.createMany({ data: fees.map((f, sortOrder) => ({ restaurantId: ctx.restaurantId, doctorId: doctor.id, label: f.label, amount: f.amount, sortOrder })) });
    ctx.audit({ action: 'clinic.doctor_fees_saved', entityType: 'ClDoctor', entityId: doctor.id, changes: { fees: { before, after: fees.length } } });
    return null;
  },
});

/** Whether two blocks of one weekday overlap (touching ends are fine). */
function overlaps(blocks: { weekday: number; startMin: number; endMin: number }[]): boolean {
  const sorted = [...blocks].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
  return sorted.some((b, i) => i > 0 && sorted[i - 1]!.weekday === b.weekday && sorted[i - 1]!.endMin > b.startMin);
}
