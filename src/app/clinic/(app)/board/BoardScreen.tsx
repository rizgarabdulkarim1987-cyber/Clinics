'use client';

import { useEffect, useState, useTransition } from 'react';
import { addWalkIn, callTicket, checkIn, handOver, listArrivals, listTicketFees, loadBoard, markLeft, moveTicket } from '@/app/clinic/_actions/board';
import { searchPatients } from '@/app/clinic/_actions/patients';
import { localMinutes } from '@/server/clinic/time';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { EndVisitPanel, type TicketFee } from './EndVisitPanel';

type Status = 'WAITING' | 'WITH_DOCTOR' | 'TO_PAY' | 'DONE' | 'LEFT';
interface Ticket {
  ticketId: string;
  number: number;
  status: Status;
  patientName: string;
  doctorId: string;
  doctorName: string;
  handedFromName: string | null;
}
interface BoardData {
  doctorId: string | null;
  tickets: Ticket[];
}
interface Arrival {
  bookingId: string;
  patientName: string;
  doctorName: string;
  startsAt: string;
}
interface Patient {
  patientId: string;
  name: string;
  phone: string;
}

const COLUMNS = ['WAITING', 'WITH_DOCTOR', 'TO_PAY', 'DONE'] as const;
/** How often the board asks the server again, so a desk and a doctor see the same day within seconds. */
const REFRESH_MS = 8000;
const selectClass = 'h-11 rounded-md border border-line bg-bg px-2';

const clock = (iso: string) => {
  const m = localMinutes(new Date(iso));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export function BoardScreen({
  role,
  initial,
  initialArrivals,
  doctors,
}: {
  role: 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';
  initial: BoardData;
  initialArrivals: Arrival[];
  doctors: { doctorId: string; name: string }[];
}) {
  const t = useT();
  const desk = role === 'OWNER' || role === 'RECEPTION';
  const [pending, start] = useTransition();
  const [data, setData] = useState<BoardData>(initial);
  const [arrivals, setArrivals] = useState<Arrival[]>(initialArrivals);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Patient[]>([]);
  const [speciality, setSpeciality] = useState('');
  const [target, setTarget] = useState<Record<string, string>>({});
  const [ending, setEnding] = useState<{ ticketId: string; fees: TicketFee[] } | null>(null);

  const refresh = async () => {
    const [board, list] = await Promise.all([loadBoard({}), desk ? listArrivals({}) : Promise.resolve(null)]);
    if (board.ok) setData(board.data);
    if (list?.ok) setArrivals(list.data);
  };

  useEffect(() => {
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = (task: () => Promise<{ ok: boolean }>, after?: (result: never) => void) =>
    start(async () => {
      setFailed(false);
      const result = await task();
      if (!result.ok) setFailed(true);
      else after?.(result as never);
      await refresh();
    });

  const otherDoctors = (ticket: Ticket) => doctors.filter((d) => d.doctorId !== ticket.doctorId);

  const buttons = (ticket: Ticket) => {
    const chosen = target[ticket.ticketId] ?? '';
    const picker = (
      <select aria-label={t('clinic.app.board.pickDoctor')} className={selectClass} value={chosen} onChange={(event) => setTarget((all) => ({ ...all, [ticket.ticketId]: event.target.value }))}>
        <option value="">{t('clinic.app.board.pickDoctor')}</option>
        {otherDoctors(ticket).map((d) => (
          <option key={d.doctorId} value={d.doctorId}>
            {d.name}
          </option>
        ))}
      </select>
    );
    const canPick = doctors.length > 0;
    if (ticket.status === 'WAITING') {
      return (
        <>
          {(desk || role === 'DOCTOR') && (
            <Button variant="primary" disabled={pending} onClick={() => act(() => callTicket({ ticketId: ticket.ticketId }))}>
              {t('clinic.app.board.call')}
            </Button>
          )}
          {desk && canPick && picker}
          {desk && chosen && (
            <Button variant="secondary" disabled={pending} onClick={() => act(() => moveTicket({ ticketId: ticket.ticketId, doctorId: chosen }))}>
              {t('clinic.app.board.move')}
            </Button>
          )}
          {desk && (
            <Button variant="secondary" disabled={pending} onClick={() => act(() => markLeft({ ticketId: ticket.ticketId }))}>
              {t('clinic.app.board.left')}
            </Button>
          )}
        </>
      );
    }
    if (ticket.status === 'WITH_DOCTOR') {
      return (
        <>
          {(desk || role === 'DOCTOR') && (
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                act(
                  () => listTicketFees({ ticketId: ticket.ticketId }),
                  (result: { data: TicketFee[] }) => setEnding({ ticketId: ticket.ticketId, fees: result.data }),
                )
              }
            >
              {t('clinic.app.board.end')}
            </Button>
          )}
          {(desk || role === 'DOCTOR') && canPick && picker}
          {(desk || role === 'DOCTOR') && chosen && (
            <Button variant="secondary" disabled={pending} onClick={() => act(() => handOver({ ticketId: ticket.ticketId, doctorId: chosen }))}>
              {t('clinic.app.board.handOver')}
            </Button>
          )}
        </>
      );
    }
    if (ticket.status === 'TO_PAY' && role !== 'DOCTOR') return <span className="text-sm text-muted">{t('clinic.app.board.toPayHint')}</span>;
    return null;
  };

  return (
    <div className="flex flex-col gap-8">
      {failed && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {t('clinic.app.board.failed')}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-surface px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      {desk && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-md border border-line p-4">
            <h2 className="text-lg font-semibold">{t('clinic.app.board.walkIn')}</h2>
            <Field label={t('clinic.app.board.walkInPick')}>
              <Input
                size="lg"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  start(async () => {
                    const result = await searchPatients({ query: event.target.value });
                    if (result.ok) setFound(result.data);
                  });
                }}
              />
            </Field>
            <Field label={t('clinic.app.board.speciality')}>
              <Input value={speciality} onChange={(event) => setSpeciality(event.target.value)} />
            </Field>
            {query.trim() !== '' && (
              <ul className="flex flex-wrap gap-2">
                {found.slice(0, 8).map((p) => (
                  <li key={p.patientId}>
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        act(
                          () => addWalkIn({ patientId: p.patientId, ...(speciality.trim() ? { speciality } : {}) }),
                          (result: { data: { number: number } }) => {
                            setNotice(t('clinic.app.board.given', { number: result.data.number }));
                            setQuery('');
                            setFound([]);
                          },
                        )
                      }
                    >
                      {t('clinic.app.board.addWalkIn')} · {p.name}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-md border border-line p-4">
            <h2 className="text-lg font-semibold">{t('clinic.app.board.arrivals')}</h2>
            {arrivals.length === 0 ? (
              <p className="text-sm text-muted">{t('clinic.app.board.noArrivals')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {arrivals.map((a) => (
                  <li key={a.bookingId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span dir="ltr" className="me-3 font-semibold tabular-nums">
                        {clock(a.startsAt)}
                      </span>
                      {a.patientName} <span className="text-sm text-muted">· {a.doctorName}</span>
                    </span>
                    <Button variant="primary" disabled={pending} onClick={() => act(() => checkIn({ bookingId: a.bookingId }))}>
                      {t('clinic.app.board.arrived')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        {COLUMNS.filter((status) => role !== 'CASHIER' || status === 'TO_PAY' || status === 'DONE').map((status) => {
          const tickets = data.tickets.filter((ticket) => ticket.status === status);
          return (
            <section key={status} aria-label={t(`clinic.app.board.col.${status}`)} className="flex flex-col gap-3 rounded-md bg-surface p-3">
              <h2 className="flex items-center justify-between font-semibold">
                {t(`clinic.app.board.col.${status}`)}
                <span className="text-sm text-muted tabular-nums">{tickets.length}</span>
              </h2>
              {tickets.length === 0 ? (
                <p className="text-sm text-muted">{t('clinic.app.board.nobody')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {tickets.map((ticket) => (
                    <li key={ticket.ticketId} className="flex flex-col gap-2 rounded-md border border-line bg-bg p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xl font-semibold tabular-nums">{ticket.number}</span>
                        <span className="truncate text-sm text-muted">{ticket.doctorName}</span>
                      </div>
                      <p className="truncate font-medium">{ticket.patientName}</p>
                      {ticket.handedFromName && <p className="text-sm text-muted">{t('clinic.app.board.from', { name: ticket.handedFromName })}</p>}
                      <div className="flex flex-wrap items-center gap-2">{buttons(ticket)}</div>
                      {ending?.ticketId === ticket.ticketId && (
                        <EndVisitPanel
                          ticketId={ticket.ticketId}
                          fees={ending.fees}
                          canWrite={role === 'DOCTOR'}
                          onCancel={() => setEnding(null)}
                          onDone={() => {
                            setEnding(null);
                            void refresh();
                          }}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
