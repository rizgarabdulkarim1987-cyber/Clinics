'use client';

import { useEffect, useState, useTransition } from 'react';
import { getPatientAlert, savePatientAlert } from '@/app/clinic/_actions/patient-file';
import { listPatientVisits } from '@/app/clinic/_actions/visits';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Textarea } from '@/studio/ui/Textarea';

interface Past {
  visitId: string;
  doctorName: string;
  complaint: string;
  note: string;
  createdAt: string;
}

/** What a doctor sees of this patient before ending the visit: the alert (editable) and the visits they may read. */
export function PatientHistory({ patientId }: { patientId: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [alert, setAlert] = useState<string | null>(null);
  const [visits, setVisits] = useState<Past[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([getPatientAlert({ patientId }), listPatientVisits({ patientId })]).then(([a, v]) => {
      if (!live) return;
      setAlert(a.ok ? a.data.text : '');
      setVisits(v.ok ? v.data : []);
    });
    return () => {
      live = false;
    };
  }, [patientId]);

  if (alert === null || visits === null) return <p className="text-sm text-muted">{t('clinic.app.file.loading')}</p>;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{t('clinic.app.alert.title')}</span>
        <Textarea
          rows={2}
          maxLength={300}
          value={alert}
          placeholder={t('clinic.app.alert.hint')}
          onChange={(event) => {
            setAlert(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          pending={pending}
          onClick={() =>
            start(async () => {
              const result = await savePatientAlert({ patientId, text: alert });
              if (result.ok) setSaved(true);
            })
          }
        >
          {t('clinic.app.alert.save')}
        </Button>
        {saved ? <span className="text-sm text-muted">{t('clinic.app.alert.saved')}</span> : null}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{t('clinic.app.history.title')}</span>
        {visits.length === 0 ? (
          <p className="text-sm text-muted">{t('clinic.app.history.none')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {visits.slice(0, 5).map((v) => (
              <li key={v.visitId} className="flex flex-col gap-0.5 py-2">
                <span className="text-muted">
                  <span dir="ltr" className="tabular-nums">
                    {v.createdAt.slice(0, 10)}
                  </span>{' '}
                  · {v.doctorName}
                </span>
                {v.complaint ? <span className="font-medium">{v.complaint}</span> : null}
                {v.note ? <span>{v.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
