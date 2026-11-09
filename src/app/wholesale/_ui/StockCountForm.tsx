'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { postStockCount } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, Field, Input, Select } from '@/studio/ui';

type Row = { itemId: string; label: string; unit: string; book: Record<string, string> };

/** Count one warehouse: type what is really on the shelf; leave an item empty to skip it. A gain with nothing on hand asks a cost. */
export function StockCountForm({ warehouses, rows, unitLabels }: { warehouses: { id: string; label: string }[]; rows: Row[]; unitLabels: Record<string, string> }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const shown = useMemo(() => rows.filter((r) => !q.trim() || r.label.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const filled = rows.filter((r) => (counted[`${warehouseId}:${r.itemId}`] ?? '').trim() !== '');

  const submit = () =>
    start(async () => {
      const counts = filled.map((r) => ({ itemId: r.itemId, countedBase: counted[`${warehouseId}:${r.itemId}`]!.trim(), ...(costs[`${warehouseId}:${r.itemId}`]?.trim() ? { unitCostIqd: costs[`${warehouseId}:${r.itemId}`]!.trim() } : {}) }));
      const r = await settle(() => postStockCount({ warehouseId, counts }));
      if (!r.ok) return void toast.error(describeFailure(t, locale, r.error).message);
      toast.success(`${t('wh.count.done')}: ${r.data.differences}`);
      setCounted({});
      setCosts({});
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('wh.stock.warehouse')}>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} options={warehouses.map((w) => ({ value: w.id, label: w.label }))} />
        </Field>
        <Field label={t('wh.count.search')}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
      </div>
      <ul className="flex max-h-[28rem] flex-col overflow-y-auto rounded-md border border-line">
        {shown.map((r) => {
          const key = `${warehouseId}:${r.itemId}`;
          const book = r.book[warehouseId] ?? '0';
          const c = (counted[key] ?? '').trim();
          const gain = c !== '' && Number(c) > Number(book);
          return (
            <li key={r.itemId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3 last:border-0">
              <span className="min-w-0 flex-1" dir="auto">
                <span className="block truncate text-base font-medium">{r.label}</span>
                <span className="block text-sm text-muted">
                  {t('wh.count.book')}: <span dir="ltr">{Number(book).toLocaleString('en-US', { maximumFractionDigits: 4 })}</span> {unitLabels[r.unit] ?? r.unit}
                </span>
              </span>
              {gain && Number(book) === 0 && (
                <div className="w-32"><Input aria-label={t('wh.count.cost')} placeholder={t('wh.count.cost')} inputMode="decimal" dir="ltr" value={costs[key] ?? ''} onChange={(e) => setCosts({ ...costs, [key]: e.target.value })} /></div>
              )}
              <div className="w-32"><Input aria-label={r.label} placeholder={t('wh.count.counted')} inputMode="decimal" dir="ltr" value={counted[key] ?? ''} onChange={(e) => setCounted({ ...counted, [key]: e.target.value })} /></div>
            </li>
          );
        })}
      </ul>
      <Button type="button" pending={pending} disabled={filled.length === 0} onClick={submit}>
        {t('wh.count.post')} ({filled.length})
      </Button>
    </div>
  );
}
