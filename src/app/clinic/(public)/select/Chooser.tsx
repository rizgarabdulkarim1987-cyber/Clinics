'use client';

import { useTransition } from 'react';
import { chooseClinicAction } from '@/app/clinic/_actions/staff';
import { useT } from '@/studio/i18n';
import { navigateAway } from '@/studio/navigate';

export function ClinicChooser({ clinics }: { clinics: Array<{ restaurantId: string; name: string; role: string }> }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <ul className="flex flex-col gap-2">
      {clinics.map((clinic) => (
        <li key={clinic.restaurantId}>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await chooseClinicAction({ restaurantId: clinic.restaurantId });
                if (result.ok) navigateAway(result.data.next);
              })
            }
            className="flex w-full min-h-14 flex-col items-start rounded-md border border-line-strong bg-raised px-4 py-3 text-start transition-colors hover:border-ink disabled:opacity-60"
          >
            <span className="font-medium">{clinic.name}</span>
            <span className="text-sm text-muted">{t(`clinic.app.role.${clinic.role}`)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
