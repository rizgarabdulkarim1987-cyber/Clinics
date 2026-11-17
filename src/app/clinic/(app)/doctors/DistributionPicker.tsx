'use client';

import { useState, useTransition } from 'react';
import { saveDistribution } from '@/app/clinic/_actions/board';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';

const RULES = ['SHORTEST_WAIT', 'OWN_DOCTOR', 'SPECIALITY', 'TURN'] as const;
type Rule = (typeof RULES)[number];

/** The owner's rule for giving a walk-in to a doctor. The receptionist can always move the token afterwards. */
export function DistributionPicker({ initial }: { initial: Rule }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [rule, setRule] = useState<Rule>(initial);
  const [saved, setSaved] = useState<boolean | null>(null);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <h2 className="text-lg font-semibold">{t('clinic.app.distribution.title')}</h2>
      <fieldset className="flex flex-col gap-2">
        {RULES.map((value) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="distribution" checked={rule === value} onChange={() => setRule(value)} />
            <span>{t(`clinic.app.distribution.${value}`)}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          pending={pending}
          onClick={() =>
            start(async () => {
              const result = await saveDistribution({ rule });
              setSaved(result.ok);
            })
          }
        >
          {t('clinic.app.distribution.save')}
        </Button>
        {saved !== null && (
          <span role="status" className={saved ? 'text-sm text-muted' : 'text-sm text-danger'}>
            {t(saved ? 'clinic.app.doctors.saved' : 'clinic.app.doctors.failed')}
          </span>
        )}
      </div>
    </div>
  );
}
