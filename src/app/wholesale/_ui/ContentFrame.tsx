'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Keeps a page's content to a readable width, centred, so on a wide screen forms and lists are not stretched across the whole
 * window. The sales screen is a work surface that wants the full width, so it is left alone.
 */
export function ContentFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const full = pathname === '/wholesale/sales';
  return <div className={full ? 'flex min-h-0 flex-1 flex-col' : 'mx-auto flex w-full max-w-5xl flex-1 flex-col'}>{children}</div>;
}
