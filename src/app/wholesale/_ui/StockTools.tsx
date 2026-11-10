'use client';

import { ArrowLeftRight, ClipboardList, PackagePlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Chip, type Tone } from './Ui';

const ICONS = { add: PackagePlus, send: ArrowLeftRight, count: ClipboardList } as const;
export type StockTool = { key: keyof typeof ICONS; tone: Tone; title: string; hint?: string; body: ReactNode };

/** The stock actions as big tiles side by side; tapping one opens its form right under them (one at a time, no animation). */
export function StockTools({ tools }: { tools: StockTool[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = tools.find((x) => x.key === open) ?? null;
  return (
    <div className="flex flex-col gap-3">
      <div className={`grid gap-3 ${tools.length >= 3 ? 'sm:grid-cols-3' : tools.length === 2 ? 'sm:grid-cols-2' : ''}`}>
        {tools.map((x) => {
          const on = open === x.key;
          return (
            <button
              key={x.key}
              type="button"
              aria-pressed={on}
              onClick={() => setOpen(on ? null : x.key)}
              className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 text-start shadow-[0_1px_2px_rgb(15_42_74/0.06)] ${on ? 'border-wh-blue bg-wh-blue-wash' : 'border-line bg-raised hover:bg-hover'}`}
            >
              <Chip icon={ICONS[x.key]} tone={x.tone} size="size-11" />
              <span className="min-w-0">
                <span className="block text-base font-semibold">{x.title}</span>
                {x.hint && <span className="block truncate text-sm text-muted">{x.hint}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {current && <section className="rounded-xl border border-line bg-raised p-4 shadow-[0_1px_2px_rgb(15_42_74/0.06)]">{current.body}</section>}
    </div>
  );
}
