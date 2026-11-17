import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { listArrivals, loadBoard } from '@/server/clinic/actions/board';
import { listDoctors } from '@/server/clinic/actions/doctors';
import { spaceBase } from '@/server/clinic/space';
import { clinicTranslator } from '@/server/clinic/translator';
import { BoardScreen } from './BoardScreen';

/** The day board, for every role: each sees what its role may. The arrivals and the doctor list are the desk's alone. */
export default async function ClinicBoardPage() {
  const { member, space } = await requireClScreen('board');
  const desk = member.role === 'OWNER' || member.role === 'RECEPTION';
  const [board, arrivals, doctors] = await Promise.all([
    invokeCl(loadBoard, {}),
    desk ? invokeCl(listArrivals, {}) : Promise.resolve(null),
    desk ? invokeCl(listDoctors, {}) : Promise.resolve(null),
  ]);
  if (!board.ok) notFound();
  const t = await clinicTranslator();
  // The waiting-room screen's address and its code, for the desk to put on a wall or show to a patient.
  let wait: { url: string; qr: string } | null = null;
  if (desk) {
    const sent = await headers();
    const host = sent.get('x-forwarded-host') ?? sent.get('host') ?? '';
    const url = `${sent.get('x-forwarded-proto') ?? 'https'}://${host}${spaceBase(space)}/wait/${member.restaurantId}`;
    wait = { url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
  }
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.board.title')}</h1>
        <p className="text-muted">{t('clinic.app.board.intro')}</p>
      </div>
      <BoardScreen
        role={member.role}
        initial={board.data}
        initialArrivals={arrivals?.ok ? arrivals.data : []}
        wait={wait}
        clinical={space === 'CLINIC'}
        doctors={doctors?.ok ? doctors.data.flatMap((d) => (d.doctorId && d.active ? [{ doctorId: d.doctorId, name: d.name }] : [])) : []}
      />
    </section>
  );
}
