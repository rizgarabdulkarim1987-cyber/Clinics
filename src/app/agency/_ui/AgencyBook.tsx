'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { AccountsBook } from '@/server/studio/queries/accounts';
import { useT } from '@/studio/i18n';
import { BrandLogo } from '@/studio/shell/BrandLogo';
import { LanguageSwitch } from '@/studio/shell/LanguageSwitch';
import { cx } from '@/studio/ui/cx';
import { EntryTab } from './EntryTab';
import { RateBar } from './RateBar';
import { ReportsTab } from './ReportsTab';

const TABS = ['entry', 'reports'] as const;
type Tab = (typeof TABS)[number];

/**
 * The agency's books on one screen: a slim bar, and two tabs, Entry (the default) and Reports. Both stay mounted, so
 * what was typed in Entry is still there after a look at Reports.
 */
export function AgencyBook({ book, today, userName }: { book: AccountsBook; today: string; userName: string }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('entry');
  const id = useId();
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ entry: null, reports: null });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    // Arrow keys follow the reading direction: in Arabic, left is the next tab.
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const next = TABS[(TABS.indexOf(tab) + (rtl ? -step : step) + TABS.length) % TABS.length]!;
    setTab(next);
    refs.current[next]?.focus();
    event.preventDefault();
  };

  return (
    <div className="min-h-dvh bg-bg lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden">
      <header className="border-b border-line bg-surface">
        <div className="flex h-14 w-full items-center justify-between gap-4 px-4 sm:px-10">
          <span dir="ltr" lang="en" className="inline-flex items-center gap-2 text-md leading-none">
            <BrandLogo height={16} />
            <span className="text-muted">Agency</span>
          </span>
          <div className="flex items-center gap-4">
            <span className="hidden max-w-[16ch] truncate text-sm text-muted sm:inline">{userName}</span>
            <LanguageSwitch signedIn />
          </div>
        </div>
      </header>

      <main className="flex w-full flex-col gap-5 px-4 pb-16 pt-6 sm:px-10 lg:min-h-0 lg:flex-1 lg:gap-3 lg:pb-4 lg:pt-3">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div>
            <h1 className="text-xl font-semibold text-text">{t('accounts.title')}</h1>
            <p className="text-base text-muted">{t('accounts.description')}</p>
          </div>
          <RateBar key={book.rate ?? 'none'} rate={book.rate} />
        </div>

        <div role="tablist" aria-label={t('accounts.tabs.label')} onKeyDown={onKeyDown} className="flex gap-1 border-b border-line">
          {TABS.map((value) => (
            <button
              key={value}
              ref={(node) => {
                refs.current[value] = node;
              }}
              role="tab"
              id={`${id}-tab-${value}`}
              aria-selected={tab === value}
              aria-controls={`${id}-panel-${value}`}
              tabIndex={tab === value ? 0 : -1}
              onClick={() => setTab(value)}
              className={cx(
                '-mb-px h-10 border-b-2 px-4 text-base font-medium transition-colors duration-150',
                tab === value ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
              )}
            >
              {t(`accounts.tab.${value}`)}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`${id}-panel-entry`} aria-labelledby={`${id}-tab-entry`} hidden={tab !== 'entry'} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <EntryTab book={book} today={today} />
        </div>
        <div role="tabpanel" id={`${id}-panel-reports`} aria-labelledby={`${id}-tab-reports`} hidden={tab !== 'reports'} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <ReportsTab book={book} today={today} />
        </div>
      </main>
    </div>
  );
}
