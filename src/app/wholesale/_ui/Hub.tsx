import type { ReactNode } from 'react';

/** One pane of a hub screen: a framed surface that scrolls inside itself so the screen never grows. */
export function Pane({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-[0_1px_2px_rgb(15_23_42/0.06),0_8px_24px_-12px_rgb(15_23_42/0.12)] ${className}`}>
      <div className="min-h-0 flex-1 overflow-y-auto [&_details>summary]:min-h-9 [&_details>summary]:text-sm [&_details>summary]:font-medium [&_details>summary]:text-wh-blue [&_details]:rounded-lg [&_details]:bg-wh-blue-wash/40 [&_header]:px-4 [&_header]:pb-2 [&_header]:pt-3 [&_header_h1]:text-base [&_header_h1]:font-semibold [&_header_p]:hidden [&_header]:border-b [&_header]:border-line [&_header]:bg-canvas/60">{children}</div>
    </section>
  );
}

/** A section's parts side by side on one screen. The first pane takes the full height when there are three. */
export function Hub({ panes }: { panes: ReactNode[] }) {
  const list = panes.filter(Boolean);
  const cols = list.length === 1 ? '' : 'md:grid-cols-2';
  const rows = list.length === 3 ? 'md:grid-rows-2' : 'md:grid-rows-1';
  return (
    <div className={`grid gap-3 px-4 pb-4 pt-3 md:min-h-0 md:flex-1 md:px-6 ${cols} ${rows}`}>
      {list.map((p, i) => (
        <Pane key={i} className={list.length === 3 && i === 0 ? 'md:row-span-2' : ''}>
          {p}
        </Pane>
      ))}
    </div>
  );
}
