import type { ReactNode } from 'react';

type Names = { ckb: string; ar: string; en: string };
type T = (key: string, params?: Record<string, string | number>) => string;

export type RepTargetRow = {
  userId: string;
  name: string;
  target: { amountIqd: number | null; weightKg: number | null; pieces: number | null; items: { itemId: string; names: Names | null; baseUnit: string; qtyBase: number }[] } | null;
  done: { amountIqd: number; weightKg: number; pieces: number; items: Record<string, number> };
  percent: { amountIqd: number | null; weightKg: number | null; pieces: number | null; items: Record<string, number | null> } | null;
};

const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const nameOf = (names: Names | null, locale: string) => (names ? (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en : '');

/** One progress line: what it is, how far, a thin bar with a tick where the month itself has got to, and the percent. */
function Bar({ label, done, goal, unit, pct, pace }: { label: ReactNode; done: number; goal: number; unit: string; pct: number | null; pace: number }) {
  const p = pct ?? 0;
  const tone = p >= 100 || p >= pace ? 'bg-wh-green' : p >= pace - 25 ? 'bg-wh-amber' : 'bg-wh-rose';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium" dir="auto">
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums text-muted">
          <span dir="ltr">
            {num(done)} / {num(goal)} <span dir="auto">{unit}</span>
          </span>
          <span dir="ltr" className="font-bold text-text">
            {p}%
          </span>
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-hover" dir="ltr">
        <span className={`absolute inset-y-0 start-0 rounded-full ${tone}`} style={{ width: `${Math.min(p, 100)}%` }} />
        <span aria-hidden className="absolute -top-0.5 h-2.5 w-px bg-text/60" style={{ left: `${Math.min(pace, 100)}%` }} />
      </div>
    </div>
  );
}

/** A rep's targets for the month against what he has sold: amount, weight, pieces and each item. */
export function TargetBars({ row, pace, t, locale, wide = false }: { row: RepTargetRow; pace: number; t: T; locale: string; wide?: boolean }) {
  const tg = row.target;
  if (!tg) return <p className="text-sm text-muted">{t('wh.target.none')}</p>;
  const pc = row.percent!;
  return (
    <div className={wide ? 'grid gap-x-8 gap-y-3 sm:grid-cols-2' : 'flex flex-col gap-2.5'}>
      {tg.amountIqd !== null && <Bar label={t('wh.target.amount')} done={row.done.amountIqd} goal={tg.amountIqd} unit="IQD" pct={pc.amountIqd} pace={pace} />}
      {tg.weightKg !== null && <Bar label={t('wh.target.weight')} done={row.done.weightKg} goal={tg.weightKg} unit="kg" pct={pc.weightKg} pace={pace} />}
      {tg.pieces !== null && <Bar label={t('wh.target.pieces')} done={row.done.pieces} goal={tg.pieces} unit={t('wh.unit.PIECE')} pct={pc.pieces} pace={pace} />}
      {tg.items.map((i) => (
        <Bar key={i.itemId} label={nameOf(i.names, locale)} done={row.done.items[i.itemId] ?? 0} goal={i.qtyBase} unit={t(`wh.unit.${i.baseUnit}`)} pct={pc.items[i.itemId] ?? null} pace={pace} />
      ))}
    </div>
  );
}
