import type { RestaurantDb } from '@/server/data/tenant-db';
import { localDay, localMinutes, weekdayOf } from '../time';

/**
 * Which doctor a walk-in goes to. The candidates are the clinic's doctors who are switched on, whose person is switched
 * on and who work at that moment; when nobody is on duty every switched-on doctor is a candidate, so the front desk
 * is never left without an answer. The clinic's rule then chooses among them. The receptionist can always move the
 * token afterwards, so a rule only has to be a good first guess.
 */

export type ClRule = 'SHORTEST_WAIT' | 'OWN_DOCTOR' | 'SPECIALITY' | 'TURN';

export interface RouteInput {
  rule: ClRule;
  now: Date;
  patientId: string;
  speciality: string | undefined;
  lastTurnDoctorId: string | null;
}

interface Candidate {
  id: string;
  speciality: string;
}

async function candidates(db: RestaurantDb, now: Date): Promise<Candidate[]> {
  const today = localDay(now);
  const all = await db.clDoctor.findMany({
    where: { active: true, member: { status: 'ACTIVE' } },
    include: { hours: true, leaves: { where: { fromDay: { lte: today }, toDay: { gte: today } }, select: { id: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // A doctor on leave takes no walk-in, unless every doctor is away: the desk is never left without an answer.
  const present = all.filter((d) => d.leaves.length === 0);
  const doctors = present.length > 0 ? present : all;
  const weekday = weekdayOf(today);
  const minute = localMinutes(now);
  const onDuty = doctors.filter((d) => d.hours.some((h) => h.weekday === weekday && h.startMin <= minute && minute < h.endMin));
  return (onDuty.length > 0 ? onDuty : doctors).map((d) => ({ id: d.id, speciality: d.speciality }));
}

/** Open tickets (waiting or with the doctor) of the clinic's day, per doctor. */
async function openCounts(db: RestaurantDb, day: string): Promise<Map<string, number>> {
  const open = await db.clTicket.findMany({ where: { day, status: { in: ['WAITING', 'WITH_DOCTOR'] } }, select: { doctorId: true } });
  const counts = new Map<string, number>();
  for (const t of open) counts.set(t.doctorId, (counts.get(t.doctorId) ?? 0) + 1);
  return counts;
}

/** The first of `pool` (already in doctor order) with the fewest open tickets. */
function shortest(pool: Candidate[], counts: Map<string, number>): Candidate {
  return pool.reduce((best, next) => ((counts.get(next.id) ?? 0) < (counts.get(best.id) ?? 0) ? next : best));
}

/** The doctor for a walk-in, or null when the clinic has no doctor who can take one. */
export async function routeDoctor(db: RestaurantDb, input: RouteInput): Promise<{ doctorId: string } | null> {
  const pool = await candidates(db, input.now);
  if (pool.length === 0) return null;
  const counts = await openCounts(db, localDay(input.now));

  if (input.rule === 'OWN_DOCTOR') {
    const last = await db.clTicket.findFirst({ where: { patientId: input.patientId }, orderBy: { createdAt: 'desc' }, select: { doctorId: true } });
    const own = pool.find((d) => d.id === last?.doctorId);
    if (own) return { doctorId: own.id };
  }
  if (input.rule === 'SPECIALITY' && input.speciality?.trim()) {
    const wanted = input.speciality.trim().toLowerCase();
    const matching = pool.filter((d) => d.speciality.trim().toLowerCase() === wanted);
    if (matching.length > 0) return { doctorId: shortest(matching, counts).id };
  }
  if (input.rule === 'TURN') {
    const at = pool.findIndex((d) => d.id === input.lastTurnDoctorId);
    return { doctorId: pool[at < 0 ? 0 : (at + 1) % pool.length]!.id };
  }
  return { doctorId: shortest(pool, counts).id };
}
