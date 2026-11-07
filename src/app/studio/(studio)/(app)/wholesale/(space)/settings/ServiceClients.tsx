'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createWholesaleClient, revokeWholesaleClient } from '@/app/studio/_actions/wholesale';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { CopyButton } from '@/studio/ui/CopyButton';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

export interface ServiceClientRow {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * The keys Wholesale asks Core with ("is this company's subscription live?"). The platform owner makes one, sees its secret
 * once (only a hash is kept), and puts it in the Wholesale server's `CORE_SERVICE_SECRET`. A revoked key stops working at once.
 */
export function ServiceClients({ clients }: { clients: ServiceClientRow[] }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<DescribedFailure | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const day = (date: Date) => new Date(date).toLocaleDateString(locale);

  const create = () =>
    start(async () => {
      const result = await settle(() => createWholesaleClient({ name }));
      if (!result.ok) return setFailure(describeFailure(t, locale, result.error));
      setFailure(null);
      setName('');
      setShown(result.data.secret);
      router.refresh();
    });

  const revoke = (id: string) =>
    start(async () => {
      const result = await settle(() => revokeWholesaleClient({ id }));
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error).message);
        return;
      }
      toast.success(t('wholesale.keys.revoked'));
      router.refresh();
    });

  const general = failure && Object.keys(failure.fields).length === 0 ? failure.message : null;

  return (
    <section aria-labelledby="wholesale-keys" className="flex flex-col gap-4">
      <h2 id="wholesale-keys" className="text-md font-semibold text-text">
        {t('wholesale.keys.title')}
      </h2>
      <p className="max-w-[72ch] text-sm text-muted">{t('wholesale.keys.intro')}</p>

      {shown && (
        <Alert tone="success">
          <div className="flex flex-col gap-2">
            <p className="font-medium">{t('wholesale.keys.once')}</p>
            <code dir="ltr" className="break-all rounded-md bg-surface px-3 py-2 text-start font-mono text-sm text-text">
              {shown}
            </code>
            <div className="flex gap-2">
              <CopyButton value={shown} />
              <Button size="sm" variant="secondary" onClick={() => setShown(null)}>
                {t('wholesale.keys.done')}
              </Button>
            </div>
          </div>
        </Alert>
      )}

      <div className="flex max-w-xl flex-col gap-3">
        <Field label={t('wholesale.keys.name')} hint={t('wholesale.keys.nameHint')} error={failure?.fields.name}>
          <Input value={name} maxLength={80} disabled={pending} onChange={(event) => setName(event.target.value)} />
        </Field>
        {general && <Alert tone="danger">{general}</Alert>}
        <div>
          <Button variant="primary" onClick={create} disabled={pending || name.trim() === ''} pending={pending}>
            {t('wholesale.keys.create')}
          </Button>
        </div>
      </div>

      {clients.length === 0 ? (
        <p className="text-sm text-muted">{t('wholesale.keys.none')}</p>
      ) : (
        <ul className="flex max-w-xl flex-col divide-y divide-line rounded-lg border border-line">
          {clients.map((client) => (
            <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-text">{client.name}</span>
                <span className="text-sm text-muted">
                  {client.revokedAt
                    ? t('wholesale.keys.revokedOn', { date: day(client.revokedAt) })
                    : client.lastUsedAt
                      ? t('wholesale.keys.lastUsed', { date: day(client.lastUsedAt) })
                      : t('wholesale.keys.neverUsed')}
                </span>
              </div>
              {!client.revokedAt && (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => revoke(client.id)}>
                  {t('wholesale.keys.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
