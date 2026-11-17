import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { listArrivals, loadBoard } from '@/server/clinic/actions/board';
import { listDoctors } from '@/server/clinic/actions/doctors';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { getStudioTranslator } from '@/studio/messages';
import { BoardScreen } from './BoardScreen';

/** The day board, for every role: each sees what its role may. The arrivals and the doctor list are the desk's alone. */
export default async function ClinicBoardPage() {
  const { member } = await requireClScreen('board');
  const desk = member.role === 'OWNER' || member.role === 'RECEPTION';
  const [board, arrivals, doctors] = await Promise.all([
    invokeCl(loadBoard, {}),
    desk ? invokeCl(listArrivals, {}) : Promise.resolve(null),
    desk ? invokeCl(listDoctors, {}) : Promise.resolve(null),
  ]);
  if (!board.ok) notFound();
  const t = getStudioTranslator(await requestClinicLocale());
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
        doctors={doctors?.ok ? doctors.data.flatMap((d) => (d.doctorId && d.active ? [{ doctorId: d.doctorId, name: d.name }] : [])) : []}
      />
    </section>
  );
}
