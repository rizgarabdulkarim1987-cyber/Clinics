'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, Coins, Contact, Home, PackageSearch, Receipt, ShoppingCart, Wallet, HandCoins, Settings, Truck, Users, type LucideIcon } from 'lucide-react';
import { cx } from '@/studio/ui';

const ICONS: Record<string, LucideIcon> = { home: Home, catalog: PackageSearch, stock: Boxes, customers: Contact, suppliers: Truck, purchases: ShoppingCart, sales: Receipt, treasury: Wallet, expenses: HandCoins, settings: Settings, rates: Coins, staff: Users };

export interface NavLink {
  key: string;
  href: string;
  label: string;
}

/** The places of the signed-in role. A rail on a desktop, a scrolling bar under the header on a phone. */
export function NavLinks({ links, label }: { links: NavLink[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {links.map((link) => {
        const Icon = ICONS[link.key] ?? Home;
        const here = path === link.href || path.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.key}
            href={link.href}
            aria-current={here ? 'page' : undefined}
            className={cx(
              'flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-base font-medium whitespace-nowrap',
              here ? 'bg-ink text-on-ink' : 'text-text hover:bg-hover',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
