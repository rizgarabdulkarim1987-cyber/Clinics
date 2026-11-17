import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { whatsappLink } from '@/lib/whatsapp';
import { defineClAction } from '../framework';
import { dayRange, isDay, localDay, localMinutes } from '../time';

/**
 * Appointment reminders. There is no message gateway: the desk gets tomorrow's booked patients, each with a WhatsApp
 * link that opens the chat with the message already typed, and marks each one as sent. The wording is the owner's, with
 * {name} {clinic} {day} {time}; when it is empty a built-in text is used. Contact details and times only: no clinical text.
 */

const DAY_MS = 86_400_000;
const MAX_TEXT = 400;
const DEFAULT_TEXT = 'مرحباً {name}، نذكّرك بموعدك في {clinic} يوم {day} الساعة {time}. إذا تحتاج تغيير الموعد راسلنا.';
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

function fill(template: string, values: Record<'name' | 'clinic' | 'day' | 'time', string>): string {
  return template.replace(/\{(name|clinic|day|time)\}/g, (_, key: keyof typeof values) => values[key]);
}

export const listReminders = defineClAction({
  name: 'clinic.reminders.list',
  roles: ['OWNER', 'RECEPTION'],
  input: z.object({ day: z.string().refine(isDay, 'A date as YYYY-MM-DD').optional() }),
  run: async (ctx, input) => {
    const day = input.day ?? localDay(new Date(Date.now() + DAY_MS));
    const { start, end } = dayRange(day);
    const [settings, rows] = await Promise.all([
      ctx.db.clSettings.findFirst({ select: { reminderText: true } }),
      ctx.db.clBooking.findMany({
        where: { status: 'BOOKED', startsAt: { gte: start, lt: end } },
        include: { patient: { select: { name: true, phone: true } }, doctor: { select: { member: { select: { account: { select: { name: true } } } } } }, service: { select: { name: true } } },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: 300,
      }),
    ]);
    const template = settings?.reminderText ?? null;
    return {
      day,
      template,
      rows: rows.map((b) => {
        const time = hhmm(localMinutes(b.startsAt));
        const text = fill(template ?? DEFAULT_TEXT, { name: b.patient.name, clinic: ctx.member.clinicName, day, time });
        return {
          bookingId: b.id,
          time,
          patientName: b.patient.name,
          phone: b.patient.phone,
          doctorName: b.doctor.member.account.name,
          serviceName: b.service?.name ?? null,
          remindedAt: b.remindedAt,
          link: whatsappLink(b.patient.phone, text),
        };
      }),
    };
  },
});

export const markReminded = defineClAction({
  name: 'clinic.reminders.mark',
  roles: ['OWNER', 'RECEPTION'],
  input: z.object({ bookingId: z.string().min(1).max(64) }),
  run: async (ctx, { bookingId }) => {
    const { count } = await ctx.db.clBooking.updateMany({ where: { id: bookingId, status: 'BOOKED' }, data: { remindedAt: new Date() } });
    if (count === 0) throw new StudioError('INVALID', 'This booking can no longer be reminded');
    return null;
  },
});

export const saveReminderText = defineClAction({
  name: 'clinic.reminders.saveText',
  roles: ['OWNER'],
  input: z.object({ text: z.string().max(MAX_TEXT) }),
  run: async (ctx, { text }) => {
    const value = text.trim() === '' ? null : text.trim();
    const row = await ctx.db.clSettings.findFirst({ select: { id: true, reminderText: true } });
    if (row) await ctx.db.clSettings.updateMany({ where: { id: row.id }, data: { reminderText: value } });
    else await ctx.db.clSettings.create({ data: { restaurantId: ctx.restaurantId, reminderText: value } });
    ctx.audit({ action: 'clinic.reminder_text_saved', entityType: 'ClSettings', entityId: row?.id ?? ctx.restaurantId, changes: { reminderText: { before: row?.reminderText === null || row === null ? null : 'set', after: value === null ? null : 'set' } } });
    return null;
  },
});
