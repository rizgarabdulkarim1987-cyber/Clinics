'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { fillDemo } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert, Button } from '@/studio/ui';

/** Fills an empty company with sample suppliers and items to try the program. Shown only while the company has none. */
export function DemoFill() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-raised p-4">
      <h2 className="text-md font-semibold">{t('wh.demo.title')}</h2>
      <p className="text-sm text-muted">{t('wh.demo.hint')}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      {done ? (
        <Alert tone="success">{t('wh.demo.done')}</Alert>
      ) : (
        <div>
          <Button
            type="button"
            variant="primary"
            pending={pending}
            onClick={() => {
              if (!window.confirm(t('wh.demo.confirm'))) return;
              setError(null);
              start(async () => {
                const r = await settle(() => fillDemo({}));
                if (r.ok) {
                  setDone(true);
                  router.refresh();
                } else setError(describeFailure(t, locale, r.error).message);
              });
            }}
          >
            {t('wh.demo.button')}
          </Button>
        </div>
      )}
    </section>
  );
}
