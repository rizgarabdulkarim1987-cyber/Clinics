import type { ReactNode } from 'react';

/** The page area of every Wholesale screen: the full width, filling the height under the notice. */
export function ContentFrame({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>;
}
