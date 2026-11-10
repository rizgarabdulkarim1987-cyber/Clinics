'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { fillDemo, removeDemo } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert, Button } from '@/studio/ui';

/** Sample data to try the program: add it while it is missing, take it out again when it is in. */
export function DemoFill({ canAdd, canRemove }: { canAdd: boolean; canRemove: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = (kind: 'add' | 'remove') => {
    if (!window.confirm(t(kind === 'add' ? 'wh.demo.confirm' : 'wh.demo.confirmRemove'))) return;
    setError(null);
    setNote(null);
    start(async () => {
      const r = await settle(() => (kind === 'add' ? fillDemo({}) : removeDemo({})));
      if (r.ok) {
        const kept = (r.data as { kept?: number }).kept ?? 0;
        setNote(kind === 'add' ? t('wh.demo.done') : kept > 0 ? t('wh.demo.removedKept', { n: kept }) : t('wh.demo.removed'));
        router.refresh();
      } else setError(describeFailure(t, locale, r.error).message);
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-raised p-4">
      <h2 className="text-md font-semibold">{t('wh.demo.title')}</h2>
      <p className="text-sm text-muted">{t('wh.demo.hint')}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      {note && <Alert tone="success">{note}</Alert>}
      <div className="flex flex-wrap gap-2">
        {canAdd && (
          <Button type="button" variant="primary" pending={pending} onClick={() => run('add')}>
            {t('wh.demo.button')}
          </Button>
        )}
        {canRemove && (
          <Button type="button" pending={pending} onClick={() => run('remove')}>
            {t('wh.demo.remove')}
          </Button>
        )}
      </div>
    </section>
  );
}
