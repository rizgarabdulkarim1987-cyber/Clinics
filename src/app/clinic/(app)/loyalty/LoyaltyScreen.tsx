'use client';

import { useState, useTransition } from 'react';
import { saveLoyaltySettings } from '@/app/clinic/_actions/loyalty';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

interface Settings {
  enabled: boolean;
  every: number;
  rewardIqd: number;
  referralStamps: number;
}

const digits = (value: string) => value.replace(/\D/g, '');

/** The loyalty switch and its three numbers. The card is the household's: people sharing a phone share it. */
export function LoyaltyScreen({ initial }: { initial: Settings }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [every, setEvery] = useState(String(initial.every));
  const [reward, setReward] = useState(String(initial.rewardIqd));
  const [referral, setReferral] = useState(String(initial.referralStamps));
  const [saved, setSaved] = useState<boolean | null>(null);

  return (
    <div className="flex max-w-xl flex-col gap-4 rounded-md border border-line p-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span className="font-medium">{t('clinic.app.loyalty.enabled')}</span>
      </label>
      <Field label={t('clinic.app.loyalty.every')}>
        <Input dir="ltr" inputMode="numeric" value={every} onChange={(event) => setEvery(digits(event.target.value))} />
      </Field>
      <Field label={t('clinic.app.loyalty.reward')}>
        <Input dir="ltr" inputMode="numeric" value={reward} onChange={(event) => setReward(digits(event.target.value))} />
      </Field>
      <Field label={t('clinic.app.loyalty.referral')}>
        <Input dir="ltr" inputMode="numeric" value={referral} onChange={(event) => setReferral(digits(event.target.value))} />
      </Field>
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          pending={pending}
          onClick={() =>
            start(async () => {
              const result = await saveLoyaltySettings({ enabled, every: Number(every || 0), rewardIqd: Number(reward || 0), referralStamps: Number(referral || 0) });
              setSaved(result.ok);
            })
          }
        >
          {t('clinic.app.loyalty.save')}
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
