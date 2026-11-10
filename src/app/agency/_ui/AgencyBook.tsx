'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Appearance } from '@/lib/appearance';
import type { AccountsBook } from '@/server/studio/queries/accounts';
import { useT } from '@/studio/i18n';
import { BrandLogo } from '@/studio/shell/BrandLogo';
import { LanguageSwitch } from '@/studio/shell/LanguageSwitch';
import { cx } from '@/studio/ui/cx';
import { EntryTab } from './EntryTab';
import { InvoiceButton } from './InvoiceButton';
import { LogTab, type LogData } from './LogTab';
import { PlanTab } from './PlanTab';
import { QuotesTab } from './QuotesTab';
import { RateBar } from './RateBar';
import { ReportsTab } from './ReportsTab';
import { ThemeToggle } from './ThemeToggle';

const ALL_TABS = ['entry', 'reports', 'plan', 'quotes', 'log'] as const;
type Tab = (typeof ALL_TABS)[number];
/** An accountant sees the first two: the rest change settings or remove things. */
const ACCOUNTANT_TABS: readonly Tab[] = ['entry', 'reports'];

/**
 * The agency's books on one screen: a slim bar, and two tabs, Entry (the default) and Reports. Both stay mounted, so
 * what was typed in Entry is still there after a look at Reports.
 */
export function AgencyBook({ book, today, userName, appearance, admin }: { book: AccountsBook; today: string; userName: string; appearance: Appearance | null; /** Present only for a Super Admin: the log, the backups and the accountants. */ admin?: LogData }) {
  const t = useT();
  const canManage = admin !== undefined;
  const TABS = canManage ? ALL_TABS : ACCOUNTANT_TABS;
  const [tab, setTab] = useState<Tab>('entry');
  const id = useId();
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ entry: null, reports: null, plan: null, quotes: null, log: null });

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
        <div className="flex min-h-14 w-full flex-wrap items-center gap-x-8 gap-y-1 px-4 sm:px-10">
          <span dir="ltr" lang="en" className="inline-flex items-center gap-2 text-md leading-none">
            <BrandLogo height={16} />
            <span className="text-muted">Agency</span>
          </span>

          <div role="tablist" aria-label={t('accounts.tabs.label')} onKeyDown={onKeyDown} className="flex self-stretch">
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
                  '-mb-px inline-flex min-h-14 items-center border-b-2 px-4 text-base font-medium transition-colors duration-150',
                  tab === value ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
                )}
              >
                {t(`accounts.tab.${value}`)}
              </button>
            ))}
          </div>

          <div className="ms-auto flex items-center gap-4 py-2">
            <InvoiceButton book={book} today={today} />
            {canManage && <RateBar key={book.rate ?? 'none'} rate={book.rate} />}
            <span className="hidden max-w-[16ch] truncate text-sm text-muted xl:inline">{userName}</span>
            <ThemeToggle appearance={appearance} />
            <LanguageSwitch signedIn />
          </div>
        </div>
      </header>

      <main className="flex w-full flex-col px-4 pb-16 pt-5 sm:px-10 lg:min-h-0 lg:flex-1 lg:pb-5">
        <div role="tabpanel" id={`${id}-panel-entry`} aria-labelledby={`${id}-tab-entry`} hidden={tab !== 'entry'} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <EntryTab book={book} today={today} canManage={canManage} />
        </div>
        <div role="tabpanel" id={`${id}-panel-reports`} aria-labelledby={`${id}-tab-reports`} hidden={tab !== 'reports'} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <ReportsTab book={book} today={today} />
        </div>
        {admin && (
          <>
            <div role="tabpanel" id={`${id}-panel-plan`} aria-labelledby={`${id}-tab-plan`} hidden={tab !== 'plan'} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <PlanTab book={book} today={today} />
            </div>
            <div role="tabpanel" id={`${id}-panel-quotes`} aria-labelledby={`${id}-tab-quotes`} hidden={tab !== 'quotes'} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <QuotesTab book={book} today={today} />
            </div>
            <div role="tabpanel" id={`${id}-panel-log`} aria-labelledby={`${id}-tab-log`} hidden={tab !== 'log'} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <LogTab data={admin} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
