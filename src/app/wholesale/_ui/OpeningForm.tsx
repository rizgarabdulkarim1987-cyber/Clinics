'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { importOpening } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, Field, Select, Textarea } from '@/studio/ui';

const KINDS = ['STOCK', 'CUSTOMERS', 'SUPPLIERS', 'CASH'] as const;

/** One kind of opening balances at a time: pick what it is, load the file (or paste it), see the columns, import. */
export function OpeningForm({ done, columns }: { done: string[]; columns: Record<string, string> }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<(typeof KINDS)[number]>(KINDS.find((k) => !done.includes(k) || k !== 'STOCK') ?? 'CUSTOMERS');
  const [csv, setCsv] = useState('');
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);

  const submit = () =>
    start(async () => {
      setErrors([]);
      const r = await settle(() => importOpening({ kind, csv }));
      if (!r.ok) return void toast.error(describeFailure(t, locale, r.error).message);
      if (!r.data.ok) {
        setErrors(r.data.errors);
        return void toast.error(t('wh.opening.rejected'));
      }
      toast.success(`${t('wh.opening.done')}: ${r.data.imported}`);
      setCsv('');
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('wh.opening.kind')}>
        <Select value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} options={KINDS.map((k) => ({ value: k, label: t(`wh.opening.k.${k}`) }))} />
      </Field>
      <p className="text-sm text-muted" dir="ltr">
        {t('wh.opening.columns')}: <code>{columns[kind]}</code>
      </p>
      <label className="flex min-h-11 w-fit cursor-pointer items-center rounded-md border border-line-strong px-4 text-base hover:bg-hover">
        {t('wh.opening.chooseFile')}
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setCsv(await f.text());
          }}
        />
      </label>
      <Field label={t('wh.opening.paste')}>
        <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} dir="ltr" />
      </Field>
      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-danger bg-danger-wash p-3 text-base" role="alert">
          {errors.slice(0, 30).map((e, i) => (
            <li key={i} dir="auto">
              {e.row > 0 ? `${t('wh.opening.row')} ${e.row}: ` : ''}
              {e.message}
            </li>
          ))}
        </ul>
      )}
      <Button type="button" pending={pending} disabled={!csv.trim()} onClick={submit}>
        {t('wh.opening.import')}
      </Button>
    </div>
  );
}
