import type { RestaurantDb } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';

const isUniqueViolation = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';

/**
 * Makes the next token of the clinic's day: number one, two, three. Two desks asking at once both read the same last
 * number; the unique (clinic, day, number) index lets one win, and the other reads again and takes the next.
 */
export async function createTicket(db: RestaurantDb, input: { restaurantId: string; day: string; patientId: string; doctorId: string; bookingId?: string | null }) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const last = await db.clTicket.findFirst({ where: { day: input.day }, orderBy: { number: 'desc' }, select: { number: true } });
    try {
      return await db.clTicket.create({
        data: { restaurantId: input.restaurantId, day: input.day, number: (last?.number ?? 0) + 1, patientId: input.patientId, doctorId: input.doctorId, bookingId: input.bookingId ?? null },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new StudioError('INVALID', 'The desk is busy. Try again');
}
