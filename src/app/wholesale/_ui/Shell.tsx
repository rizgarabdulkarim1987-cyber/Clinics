import { Warehouse } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { WhActor } from '@/server/wholesale/actor';
import { SignOutButton } from '@/app/pos/_ui/SignOutButton';
import { ContentFrame } from './ContentFrame';
import { NavLinks, SectionLinks } from './NavLinks';
import { whGroups } from './nav';

/**
 * The frame of every Wholesale screen: the company and the person at the start side of a desktop (a bar on a phone), the
 * places the role may use, and the page. A state notice (read-only) sits above the page.
 */
export function Shell({ actor, notice, t, children }: { actor: WhActor; notice?: ReactNode; t: Translate; children: ReactNode }) {
  const groups = whGroups(actor.role).map((g) => ({ key: g.key, href: g.href, label: t(g.labelKey), match: g.match, places: g.places.map((p) => ({ key: p.key, href: p.href, label: t(p.labelKey), tab: p.tab })) }));
  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden">
      <a href="#main" className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50">
        {t('common.skipToContent')}
      </a>
      <header className="flex flex-col print:hidden gap-3 bg-wh-rail px-4 py-3 text-white md:w-60 md:shrink-0 md:overflow-y-auto md:px-3 md:py-5">
        <div className="flex items-center gap-2.5 px-1">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-wh-blue text-white">
            <Warehouse aria-hidden className="size-5" />
          </span>
          <p className="flex min-w-0 flex-col">
            <span className="sr-only">{t('wh.shell.label')}: </span>
            <span className="truncate text-base font-semibold" dir="auto">
              {actor.restaurantName}
            </span>
            <span className="truncate text-sm text-wh-rail-muted" dir="auto">
              {actor.name} · {t(`wh.role.${actor.role}`)}
            </span>
          </p>
        </div>
        <NavLinks groups={groups} label={t('wh.nav.main')} />
        <div className="hidden flex-col gap-0.5 border-t border-white/15 pt-3 md:mt-auto md:flex">
          <Link href="/studio/account" className="flex min-h-11 items-center rounded-md px-3 text-base font-medium text-white hover:bg-wh-rail-hover">
            {t('wh.shell.account')}
          </Link>
          <SignOutButton className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-base font-medium text-white hover:bg-wh-rail-hover disabled:opacity-60" />
        </div>
      </header>
      <main id="main" className="flex min-w-0 flex-1 flex-col md:overflow-y-auto">
        {notice}
        <ContentFrame>
          <SectionLinks groups={groups} />
          {children}
        </ContentFrame>
      </main>
    </div>
  );
}
