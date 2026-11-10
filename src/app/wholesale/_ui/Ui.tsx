import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Soft colour pairs for icon chips: one family, so every screen reads as the same product. */
export const TONES = {
  blue: 'bg-wh-blue-wash text-wh-blue',
  green: 'bg-wh-green-wash text-wh-green',
  amber: 'bg-wh-amber-wash text-wh-amber',
  rose: 'bg-wh-rose-wash text-wh-rose',
  violet: 'bg-wh-violet-wash text-wh-violet',
  teal: 'bg-wh-teal-wash text-wh-teal',
} as const;
export type Tone = keyof typeof TONES;

/** A round icon in a soft colour. */
export function Chip({ icon: Icon, tone = 'blue', size = 'size-9' }: { icon: LucideIcon; tone?: Tone; size?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full ${size} ${TONES[tone]}`}>
      <Icon aria-hidden className="size-4" />
    </span>
  );
}

/** A folded form or list: a card whose heading carries an icon and opens on tap. No animation. */
export function Fold({ icon, tone = 'blue', title, hint, open, children }: { icon: LucideIcon; tone?: Tone; title: ReactNode; hint?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-line bg-raised shadow-[0_1px_2px_rgb(15_42_74/0.06)]">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-3 py-1.5 text-base font-semibold hover:bg-hover [&::-webkit-details-marker]:hidden">
        <Chip icon={icon} tone={tone} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          {hint && <span className="block truncate text-sm font-normal text-muted">{hint}</span>}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted group-open:rotate-180" />
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}

/** A list row: an icon, the main lines, and the figure at the end. */
export function Row({ icon, tone = 'blue', children, end, className = '' }: { icon: LucideIcon; tone?: Tone; children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Chip icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">{children}</div>
      {end && <div className="flex shrink-0 items-center gap-3">{end}</div>}
    </div>
  );
}

/** A framed section with a small icon heading. */
export function Section({ icon, tone = 'blue', title, children, className = '' }: { icon: LucideIcon; tone?: Tone; title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-raised shadow-[0_1px_2px_rgb(15_42_74/0.06)] ${className}`}>
      <h2 className="flex items-center gap-2.5 border-b border-line px-3 py-2.5 text-md font-semibold">
        <Chip icon={icon} tone={tone} size="size-7" />
        {title}
      </h2>
      <div className="p-4">{children}</div>
    </section>
  );
}
