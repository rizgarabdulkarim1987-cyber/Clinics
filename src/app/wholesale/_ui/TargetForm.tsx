'use client';

import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setRepTarget } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui';

export type TargetItem = { id: string; label: string; unit: string };
type Initial = { amountIqd: number | null; weightKg: number | null; pieces: number | null; items: { itemId: string; qtyBase: number }[] };

const text = (n: number | null) => (n === null ? '' : String(n));
const field = 'h-9 w-full rounded-md border border-line-strong bg-raised px-2.5 text-base tabular-nums';

/** One rep's targets for a month: three totals and any number of per-item quantities. Empty means no target of that kind. */
export function TargetForm({ userId, month, initial, items }: { userId: string; month: string; initial: Initial | null; items: TargetItem[] }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(text(initial?.amountIqd ?? null));
  const [weight, setWeight] = useState(text(initial?.weightKg ?? null));
  const [pieces, setPieces] = useState(text(initial?.pieces ?? null));
  const [rows, setRows] = useState<{ itemId: string; qty: string }[]>((initial?.items ?? []).map((i) => ({ itemId: i.itemId, qty: String(i.qtyBase) })));
  const unitOf = (id: string) => items.find((i) => i.id === id)?.unit ?? '';

  const save = () =>
    start(async () => {
      const result = await settle(() =>
        setRepTarget({
          userId,
          month,
          amountIqd: amount,
          weightKg: weight,
          pieces,
          items: rows.filter((r) => r.itemId && Number(r.qty) > 0).map((r) => ({ itemId: r.itemId, qty: r.qty })),
        }),
      );
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error).message);
        return;
      }
      toast.success(t('wh.target.saved'));
      router.refresh();
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-3"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t('wh.target.amount')} (IQD)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t('wh.target.weight')} (kg)
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t('wh.target.pieces')}
          <input value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0" className={field} />
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">{t('wh.target.items')}</p>
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select aria-label={t('wh.target.item')} value={r.itemId} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className={`${field} flex-1`}>
              <option value="">—</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.label}
                </option>
              ))}
            </select>
            <input aria-label={t('wh.sw.qty')} value={r.qty} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} inputMode="decimal" dir="ltr" placeholder="0" className={`${field} w-28`} />
            <span className="w-14 text-sm text-muted">{unitOf(r.itemId)}</span>
            <button type="button" aria-label={t('wh.sw.remove')} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="grid size-8 shrink-0 place-items-center rounded-md text-wh-rose hover:bg-wh-rose-wash">
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
        <div>
          <Button type="button" variant="secondary" onClick={() => setRows((rs) => [...rs, { itemId: '', qty: '' }])}>
            <Plus aria-hidden />
            {t('wh.target.addItem')}
          </Button>
        </div>
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('wh.target.save')}
        </Button>
      </div>
    </form>
  );
}
