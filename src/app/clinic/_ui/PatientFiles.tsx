'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { deleteFile, listFiles } from '@/app/clinic/_actions/patient-files';
import { useT } from '@/studio/i18n';

interface Item {
  fileId: string;
  name: string;
  mime: string;
  bytes: number;
}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024)).toLocaleString('en')} KB`;

/** Photos and documents of one patient. Shows nothing at all for a role that may not keep them. */
export function PatientFiles({ patientId }: { patientId: string }) {
  const t = useT();
  const base = usePathname().startsWith('/beauty') ? '/beauty' : '/clinic';
  const [pending, start] = useTransition();
  const [items, setItems] = useState<Item[] | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const result = await listFiles({ patientId });
    if (!result.ok) return setAllowed(false);
    setAllowed(true);
    setItems(result.data);
  };

  useEffect(() => {
    let live = true;
    void listFiles({ patientId }).then((result) => {
      if (!live) return;
      if (!result.ok) return setAllowed(false);
      setAllowed(true);
      setItems(result.data);
    });
    return () => {
      live = false;
    };
  }, [patientId]);

  if (!allowed || items === null) return null;

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{t('clinic.app.files.title')}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('clinic.app.files.none')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((f) => (
            <li key={f.fileId} className="flex flex-col gap-1 rounded-md border border-line p-2 text-sm">
              <a href={`${base}/files/${f.fileId}`} target="_blank" rel="noopener noreferrer" className="flex flex-col gap-1">
                {f.mime.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private, authenticated file; the image optimizer cannot sign in.
                  <img src={`${base}/files/${f.fileId}`} alt={f.name} className="aspect-square w-full rounded object-cover" loading="lazy" />
                ) : (
                  <span className="flex aspect-square items-center justify-center rounded bg-line/30 font-semibold">PDF</span>
                )}
                <span className="truncate">{f.name}</span>
              </a>
              <span className="text-muted">{kb(f.bytes)}</span>
              <button
                type="button"
                disabled={pending}
                className="h-11 rounded-md border border-line disabled:opacity-60"
                onClick={() =>
                  start(async () => {
                    const result = await deleteFile({ fileId: f.fileId });
                    if (result.ok) await reload();
                  })
                }
              >
                {t('clinic.app.files.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const file = input.current?.files?.[0];
          if (!file) return;
          setFailed(false);
          start(async () => {
            const body = new FormData();
            body.set('patientId', patientId);
            body.set('file', file);
            const response = await fetch(`${base}/files`, { method: 'POST', body });
            if (!response.ok) return setFailed(true);
            if (input.current) input.current.value = '';
            await reload();
          });
        }}
      >
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required className="min-h-11 text-sm" aria-label={t('clinic.app.files.pick')} />
        <button type="submit" disabled={pending} className="h-11 rounded-md bg-fg px-4 font-medium text-bg disabled:opacity-60">
          {t('clinic.app.files.upload')}
        </button>
        {failed ? (
          <span role="alert" className="w-full text-sm">
            {t('clinic.app.files.failed')}
          </span>
        ) : null}
      </form>
    </div>
  );
}
