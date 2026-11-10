'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Boxes, Home, Receipt, Settings, Wallet, type LucideIcon } from 'lucide-react';
import { cx } from '@/studio/ui';

const ICONS: Record<string, LucideIcon> = { home: Home, sales: Receipt, stock: Boxes, money: Wallet, admin: Settings, reports: BarChart3 };

export interface NavGroup {
  key: string;
  href: string;
  label: string;
  match: string[];
}

export type NavMeta = Record<string, { sub?: string; badge?: number }>;

const within = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** The few sections of the signed-in role: a rail on a desktop, a bar with big targets on a phone. */
export function NavLinks({ groups, label, meta }: { groups: NavGroup[]; label: string; meta?: NavMeta }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 md:flex md:flex-col">
      {groups.map((g) => {
        const Icon = ICONS[g.key] ?? Home;
        const here = g.match.some((m) => within(path, m));
        const { sub, badge } = meta?.[g.key] ?? {};
        return (
          <Link
            key={g.key}
            href={g.href}
            aria-current={here ? 'page' : undefined}
            className={cx(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-sm font-medium whitespace-nowrap md:min-h-14 md:flex-row md:justify-start md:gap-2 md:px-3 md:text-base',
              here ? 'bg-wh-blue text-white' : 'text-white/90 hover:bg-wh-rail-hover',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="flex min-w-0 flex-col md:flex-1">
              <span>{g.label}</span>
              {sub && <span className={cx('hidden text-xs font-normal md:block', here ? 'text-white/80' : 'text-white/55')}>{sub}</span>}
            </span>
            {badge ? (
              <span className="rounded-full bg-wh-amber px-2 py-0.5 text-xs font-semibold tabular-nums text-white md:ms-auto" dir="ltr">
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
