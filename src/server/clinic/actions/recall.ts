import { z } from 'zod';
import { defineClAction } from '../framework';
import { localDay } from '../time';

/**
 * The recall list: patients whose last visit is older than a window and who have no booking coming up, oldest first, for
 * the desk to phone. A patient with no visit at all has not been seen, so is not recalled. Contact details only.
 */

const DAY_MS = 86_400_000;
const LIMIT = 200;

export const listRecall = defineClAction({
  name: 'clinic.recall.list',
  roles: ['OWNER', 'RECEPTION'],
  input: z.object({ days: z.number().int().min(30).max(1095).default(180) }),
  run: async (ctx, { days }) => {
    const now = Date.now();
    const cutoff = new Date(now - days * DAY_MS);
    const last = await ctx.db.clVisit.groupBy({ by: ['patientId'], _max: { createdAt: true } });
    const stale = last.flatMap((row) => (row._max.createdAt && row._max.createdAt < cutoff ? [{ patientId: row.patientId, at: row._max.createdAt }] : []));
    if (stale.length === 0) return [];
    const ids = stale.map((s) => s.patientId);
    const upcoming = await ctx.db.clBooking.findMany({ where: { status: 'BOOKED', startsAt: { gte: new Date(now) }, patientId: { in: ids } }, select: { patientId: true } });
    const booked = new Set(upcoming.map((b) => b.patientId));
    const patients = await ctx.db.clPatient.findMany({ where: { id: { in: ids.filter((id) => !booked.has(id)) } }, select: { id: true, name: true, phone: true } });
    const byId = new Map(patients.map((p) => [p.id, p]));
    return stale
      .filter((s) => byId.has(s.patientId))
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(0, LIMIT)
      .map((s) => ({ patientId: s.patientId, name: byId.get(s.patientId)!.name, phone: byId.get(s.patientId)!.phone, lastVisitDay: localDay(s.at), daysAgo: Math.floor((now - s.at.getTime()) / DAY_MS) }));
  },
});
