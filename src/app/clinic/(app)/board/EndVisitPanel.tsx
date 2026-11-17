'use client';

import { useState, useTransition } from 'react';
import { endVisit } from '@/app/clinic/_actions/board';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { Textarea } from '@/studio/ui/Textarea';

export interface TicketFee {
  feeId: string;
  label: string;
  amount: number;
}

export interface OwnedPackage {
  patientPackageId: string;
  name: string;
  sessionsLeft: number;
}

/** Tap-through complaint phrases: a doctor ends a visit in seconds, without a long form. */
const PHRASES = ['headache', 'fever', 'cough', 'stomach', 'back', 'checkup', 'followup', 'injury'] as const;

/**
 * The end-of-visit panel. A doctor taps the complaint, may add a short note that only they can read, and ticks the fees
 * to charge from their own list (the first is ticked to save a tap). The server prices the bill from the ids it is sent.
 * The desk can end a visit too, but without clinical text.
 */
export function EndVisitPanel({
  ticketId,
  fees,
  packages,
  canWrite,
  onDone,
  onCancel,
}: {
  ticketId: string;
  fees: TicketFee[];
  packages: OwnedPackage[];
  canWrite: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  // With a course to spend, the session pays for the visit, so no fee is ticked up front.
  const [chosen, setChosen] = useState<string[]>(fees[0] && packages.length === 0 ? [fees[0].feeId] : []);
  const [packageId, setPackageId] = useState('');

  const toggle = (list: string[], set: (next: string[]) => void, value: string) => set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const submit = () =>
    start(async () => {
      setFailed(false);
      const complaint = picked.map((key) => t(`clinic.app.visit.phrase.${key}`)).join(', ');
      const result = await endVisit({ ticketId, ...(canWrite && complaint ? { complaint } : {}), ...(canWrite && note.trim() ? { note } : {}), feeIds: chosen, ...(packageId ? { packageId } : {}) });
      if (result.ok) onDone();
      else setFailed(true);
    });

  return (
    <div className="flex flex-col gap-4 rounded-md border border-line bg-bg p-4">
      <h3 className="font-semibold">{t('clinic.app.visit.title')}</h3>
      {canWrite && (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm text-muted">{t('clinic.app.visit.complaint')}</legend>
            <div className="flex flex-wrap gap-2">
              {PHRASES.map((key) => (
                <Button key={key} variant={picked.includes(key) ? 'primary' : 'secondary'} aria-pressed={picked.includes(key)} onClick={() => toggle(picked, setPicked, key)}>
                  {t(`clinic.app.visit.phrase.${key}`)}
                </Button>
              ))}
            </div>
          </fieldset>
          <Field label={t('clinic.app.visit.note')}>
            <Textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-muted">{t('clinic.app.visit.fees')}</legend>
        {fees.length === 0 ? (
          <p className="text-sm text-muted">{t('clinic.app.visit.noFees')}</p>
        ) : (
          fees.map((fee) => (
            <Checkbox
              key={fee.feeId}
              checked={chosen.includes(fee.feeId)}
              onChange={() => toggle(chosen, setChosen, fee.feeId)}
              label={
                <span>
                  {fee.label} · <span dir="ltr">{fee.amount.toLocaleString('en')}</span>
                </span>
              }
            />
          ))
        )}
      </fieldset>
      {packages.length > 0 && (
        <Field label={t('clinic.app.visit.package')}>
          <select className="h-11 rounded-md border border-line bg-bg px-2" value={packageId} onChange={(event) => setPackageId(event.target.value)}>
            <option value="">{t('clinic.app.visit.package.none')}</option>
            {packages.map((p) => (
              <option key={p.patientPackageId} value={p.patientPackageId}>
                {t('clinic.app.visit.package.option', { name: p.name, left: p.sessionsLeft })}
              </option>
            ))}
          </select>
        </Field>
      )}
      {failed && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {t('clinic.app.board.failed')}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" pending={pending} onClick={submit}>
          {t('clinic.app.visit.submit')}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          {t('clinic.app.visit.back')}
        </Button>
      </div>
    </div>
  );
}
