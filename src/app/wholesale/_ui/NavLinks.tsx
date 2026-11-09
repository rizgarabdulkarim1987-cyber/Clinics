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
  places: { key: string; href: string; label: string }[];
}

const within = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** The few sections of the signed-in role: a rail on a desktop, a bar with big targets on a phone. */
export function NavLinks({ groups, label }: { groups: NavGroup[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 md:flex md:flex-col">
      {groups.map((g) => {
        const Icon = ICONS[g.key] ?? Home;
        const here = g.match.some((m) => within(path, m));
        return (
          <Link
            key={g.key}
            href={g.href}
            aria-current={here ? 'page' : undefined}
            className={cx(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-sm font-medium whitespace-nowrap md:min-h-12 md:flex-row md:justify-start md:gap-2 md:px-3 md:text-base',
              here ? 'bg-wh-blue text-white' : 'text-white/90 hover:bg-wh-rail-hover',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {g.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The places inside the section the person is in (two to four), shown above the page. Nothing when the section is one place. */
export function SectionLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const group = groups.find((g) => g.match.some((m) => within(path, m)));
  if (!group || group.places.length < 2) return null;
  return (
    <nav aria-label={group.label} className="flex gap-1 overflow-x-auto px-3 pt-3 md:px-6">
      {group.places.map((p) => {
        const here = within(path, p.href);
        return (
          <Link
            key={p.key}
            href={p.href}
            aria-current={here ? 'page' : undefined}
            className={cx('flex min-h-10 shrink-0 items-center rounded-full border px-4 text-base whitespace-nowrap', here ? 'border-wh-blue bg-wh-blue text-white' : 'border-line-strong bg-raised hover:bg-wh-blue-wash')}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
