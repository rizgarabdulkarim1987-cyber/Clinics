import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Chip, type Tone } from './Ui';

/**
 * Wholesale's page header: one slim line (the title, a hint beside it on a wide screen, the page's actions at the end) so the
 * work starts high on the screen. It replaces the Studio's tall header, whose hint line took a row of its own.
 */
export function PageHeader({ title, description, actions, icon, tone = 'blue' }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-3 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <Chip icon={icon} tone={tone} size="size-10" />}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight text-text">{title}</h1>
          {description && <p className="truncate text-sm text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A link to a place that is not a tab (suppliers, exchange rates, assistant, opening balances), shown among the page's actions. */
export function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-9 items-center rounded-md border border-line-strong bg-raised px-3 text-sm font-medium hover:bg-wh-blue-wash">
      {children}
    </Link>
  );
}
