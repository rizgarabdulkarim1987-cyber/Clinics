'use client';

import { Download, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { setAccountAccountant } from '@/app/studio/_actions/accounts';
import type { BookAccountant, BookBackup, BookLogRow } from '@/server/studio/queries/accounts';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';

export interface LogData {
  log: BookLogRow[];
  backups: BookBackup[];
  accountants: BookAccountant[];
}

/** Baghdad time with Latin digits in every language, like the rest of the books. */
const stamp = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/**
 * The log and backups tab (for Super Admins): who changed the books and when, the daily copies that can be downloaded
 * as Excel, and who has the accountant's access (read and enter, never delete).
 */
export function LogTab({ data }: { data: LogData }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();

  const give = (event: FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await setAccountAccountant({ email, on: true });
      if (result.ok) {
        toast.success(t('accounts.access.added'));
        setEmail('');
        setError(undefined);
        router.refresh();
      } else {
        const failure = describeFailure(t, locale, result.error);
        setError(failure.fields?.email ?? failure.message);
      }
    });
  };

  const take = (address: string) =>
    start(async () => {
      const result = await setAccountAccountant({ email: address, on: false });
      if (result.ok) {
        toast.success(t('accounts.access.removed'));
        router.refresh();
      } else toast.error(describeFailure(t, locale, result.error).message);
    });

  const card = 'flex flex-col gap-4 rounded-lg border border-line bg-raised p-5 lg:min-h-0';

  return (
    <div className="flex flex-col gap-4 lg:grid lg:h-full lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-5">
      <section aria-labelledby="log-title" className={`${card} lg:row-span-2`}>
        <div>
          <h2 id="log-title" className="text-md font-semibold">
            {t('accounts.log.title')}
          </h2>
          <p className="text-sm text-muted">{t('accounts.log.hint')}</p>
        </div>
        {data.log.length === 0 ? (
          <p className="rounded-md bg-surface px-4 py-3 text-sm text-muted">{t('accounts.log.empty')}</p>
        ) : (
          <ul className="divide-y divide-line overflow-y-auto rounded-md border border-line lg:min-h-0">
            {data.log.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-base font-medium">{t(`activity.action.${row.action}`)}</span>
                  <span className="block truncate text-sm text-muted">{row.actorName ?? t('accounts.log.system')}</span>
                </span>
                <span dir="ltr" className="shrink-0 text-sm tabular-nums text-muted">
                  {stamp(row.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="backups-title" className={card}>
        <div>
          <h2 id="backups-title" className="text-md font-semibold">
            {t('accounts.backups.title')}
          </h2>
          <p className="text-sm text-muted">{t('accounts.backups.hint')}</p>
        </div>
        {data.backups.length === 0 ? (
          <p className="rounded-md bg-surface px-4 py-3 text-sm text-muted">{t('accounts.backups.empty')}</p>
        ) : (
          <ul className="divide-y divide-line overflow-y-auto rounded-md border border-line lg:min-h-0">
            {data.backups.map((backup) => (
              <li key={backup.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <span dir="ltr" className="block text-base font-medium tabular-nums">
                    {backup.takenOn}
                  </span>
                  <span className="block text-sm text-muted">{t('accounts.backups.row', { count: String(backup.entries) })}</span>
                </span>
                <a
                  href={`/agency/backup?id=${encodeURIComponent(backup.id)}&lang=${locale}`}
                  aria-label={t('accounts.backups.download')}
                  title={t('accounts.backups.download')}
                  className="inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-text"
                >
                  <Download aria-hidden className="size-4" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="access-title" className={`${card} lg:overflow-y-auto`}>
        <div>
          <h2 id="access-title" className="text-md font-semibold">
            {t('accounts.access.title')}
          </h2>
          <p className="text-sm text-muted">{t('accounts.access.hint')}</p>
        </div>
        {data.accountants.length === 0 ? (
          <p className="rounded-md bg-surface px-4 py-3 text-sm text-muted">{t('accounts.access.empty')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {data.accountants.map((person) => (
              <li key={person.userId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-base font-medium">{person.name}</span>
                  <span dir="ltr" className="block truncate text-start text-sm text-muted">
                    {person.email}
                  </span>
                </span>
                <IconButton label={t('accounts.access.remove')} onClick={() => take(person.email)} disabled={pending} icon={<Trash2 aria-hidden />} />
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={give} className="flex flex-col gap-3 rounded-md bg-surface p-3">
          <Field label={t('accounts.access.email')} error={error}>
            <Input dir="ltr" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" pending={pending} icon={<Plus aria-hidden />} className="sm:w-fit">
            {t('accounts.access.add')}
          </Button>
        </form>
      </section>
    </div>
  );
}
