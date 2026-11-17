'use client';

import { clinicSignOut } from '@/app/clinic/_actions/session';
import { useT } from '@/studio/i18n';
import { navigateAway } from '@/studio/navigate';
import { Button } from '@/studio/ui/Button';

/** Ends the clinic session and goes to the clinic sign-in. */
export function SignOutButton({ className, fallback = '/clinic/sign-in' }: { className?: string; fallback?: string }) {
  const t = useT();
  return (
    <Button
      type="button"
      variant="secondary"
      className={className}
      onClick={async () => {
        const result = await clinicSignOut({});
        navigateAway(result.ok ? result.data.next : fallback);
      }}
    >
      {t('clinic.app.signOut')}
    </Button>
  );
}
