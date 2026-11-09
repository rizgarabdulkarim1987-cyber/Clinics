'use client';

import { useRef, useState, useTransition } from 'react';
import { readInvoicePhoto } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert, Button } from '@/studio/ui';

type Line = { name: string; code: string | null; qty: string | null; unitPrice: string | null; total: string | null; itemId: string | null; itemLabel: string | null };
type Reading = { party: string | null; currency: string | null; lines: Line[]; degraded?: string; used: number };

const MAX_SIDE = 1600;
const MAX_BASE64 = 880_000;

/** A photo, shrunk in the browser to a JPEG small enough to send; returns plain base64 (no data: prefix). */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  let side = scale;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * side));
    canvas.height = Math.max(1, Math.round(bitmap.height * side));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', 0.82);
    const base64 = url.slice(url.indexOf(',') + 1);
    if (base64.length <= MAX_BASE64) return base64;
    side *= 0.75;
  }
  throw new Error('tooLarge');
}

/** Photo of an invoice in, a table to check out. Nothing is saved: the person enters the invoice from this reading. */
export function InvoicePhoto({ used, limit }: { used: number; limit: number }) {
  const t = useT();
  const { locale } = useLocale();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(used);
  const input = useRef<HTMLInputElement>(null);

  const pick = (file: File | undefined) => {
    if (!file || pending) return;
    setError(null);
    setReading(null);
    setPreview(URL.createObjectURL(file));
    start(async () => {
      let base64: string;
      try {
        base64 = await shrink(file);
      } catch {
        setError(t('wh.photo.unreadable'));
        return;
      }
      const result = await settle(() => readInvoicePhoto({ photo: { mediaType: 'image/jpeg', base64 } }));
      if (result.ok) {
        const data = result.data as Reading;
        setReading(data);
        setCount(data.used);
      } else setError(describeFailure(t, locale, result.error).message);
    });
  };

  const sums = new Map<string, number>();
  if (reading) for (const l of reading.lines) if (l.total && reading.currency) sums.set(reading.currency, (sums.get(reading.currency) ?? 0) + Number(l.total));
  const unmatched = reading ? reading.lines.filter((l) => !l.itemId).length : 0;

  return (
    <section className="flex flex-col gap-4 rounded-md border border-line bg-raised p-4">
      <div>
        <h2 className="text-md font-semibold">{t('wh.photo.title')}</h2>
        <p className="text-sm text-muted">{t('wh.photo.hint')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label={t('wh.photo.choose')} onChange={(e) => pick(e.target.files?.[0])} />
        <Button type="button" variant="primary" pending={pending} onClick={() => input.current?.click()}>
          {t('wh.photo.choose')}
        </Button>
        <span className="text-sm text-muted">{t('wh.assistant.used', { used: count, limit })}</span>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {reading?.degraded && <Alert tone="neutral">{t(`wh.photo.degraded.${reading.degraded}`)}</Alert>}
      {(preview || reading) && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_1fr]">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL of the person's own photo
            <img src={preview} alt={t('wh.photo.alt')} className="max-h-72 w-full rounded-md border border-line object-contain" />
          )}
          {reading && reading.lines.length > 0 && (
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-sm text-muted">
                {reading.party && <span dir="auto">{reading.party} · </span>}
                {reading.currency ?? t('wh.photo.noCurrency')}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-base">
                  <thead className="border-b border-line text-sm text-muted">
                    <tr>
                      <th scope="col" className="py-2 text-start font-medium">{t('wh.photo.item')}</th>
                      <th scope="col" className="py-2 text-end font-medium">{t('wh.photo.qty')}</th>
                      <th scope="col" className="py-2 text-end font-medium">{t('wh.photo.price')}</th>
                      <th scope="col" className="py-2 text-end font-medium">{t('wh.photo.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reading.lines.map((l, i) => (
                      <tr key={i} className="border-b border-line align-top">
                        <td className="py-2 pe-3">
                          <span dir="auto">{l.name}</span>
                          <span className={`block text-sm ${l.itemId ? 'text-success' : 'text-danger'}`} dir="auto">
                            {l.itemLabel ?? t('wh.photo.notInCatalogue')}
                          </span>
                        </td>
                        <td className="py-2 text-end tabular-nums" dir="ltr">{l.qty ?? '—'}</td>
                        <td className="py-2 text-end tabular-nums" dir="ltr">{l.unitPrice ?? '—'}</td>
                        <td className="py-2 text-end tabular-nums" dir="ltr">{l.total ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {[...sums].map(([cur, v]) => (
                <p key={cur} className="flex justify-between border-t border-ink pt-2 text-lg font-semibold">
                  <span>{t('wh.photo.sum')}</span>
                  <span className="tabular-nums" dir="ltr">{v.toLocaleString('en-US', { maximumFractionDigits: 4 })} {cur}</span>
                </p>
              ))}
              {unmatched > 0 && <p className="text-sm text-danger">{t('wh.photo.unmatched', { n: unmatched })}</p>}
              <p className="text-sm text-muted">{t('wh.photo.notSaved')}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
