import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Wholesale's page header: one slim line (the title, a hint beside it on a wide screen, the page's actions at the end) so the
 * work starts high on the screen. It replaces the Studio's tall header, whose hint line took a row of its own.
 */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-3 md:px-6">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <h1 className="text-lg font-semibold text-text">{title}</h1>
        {description && <p className="hidden text-sm text-muted xl:block">{description}</p>}
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
