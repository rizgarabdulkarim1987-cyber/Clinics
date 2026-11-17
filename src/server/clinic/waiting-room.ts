import type { PrismaClient } from '@/generated/prisma/client';
import { restaurantDb } from '@/server/data/tenant-db';
import { localDay } from './time';

/**
 * What the waiting-room screen shows: for each doctor with people today, the number being seen and the numbers waiting.
 * Token numbers and doctor names only; a patient's name, phone or anything clinical never reaches this page. A business
 * that is not an active clinic answers as nothing.
 */

export interface WaitingRoomView {
  clinicName: string;
  day: string;
  doctors: { doctorId: string; name: string; serving: number | null; waiting: number[] }[];
}

export async function loadWaitingRoom(prisma: PrismaClient, clinicId: string): Promise<WaitingRoomView | null> {
  const clinic = await prisma.restaurant.findFirst({ where: { id: clinicId, sector: 'CLINIC', status: 'ACTIVE' }, select: { id: true, name: true } });
  if (!clinic) return null;
  const db = restaurantDb(prisma, clinic.id);
  const day = localDay(new Date());
  const tickets = await db.clTicket.findMany({ where: { day, status: { in: ['WAITING', 'WITH_DOCTOR'] } }, orderBy: { number: 'asc' }, select: { number: true, status: true, doctorId: true } });
  const doctors = await db.clDoctor.findMany({
    where: { id: { in: [...new Set(tickets.map((t) => t.doctorId))] } },
    include: { member: { select: { account: { select: { name: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    clinicName: clinic.name,
    day,
    doctors: doctors.map((d) => {
      const own = tickets.filter((t) => t.doctorId === d.id);
      return {
        doctorId: d.id,
        name: d.member.account.name,
        serving: own.find((t) => t.status === 'WITH_DOCTOR')?.number ?? null,
        waiting: own.filter((t) => t.status === 'WAITING').map((t) => t.number),
      };
    }),
  };
}
