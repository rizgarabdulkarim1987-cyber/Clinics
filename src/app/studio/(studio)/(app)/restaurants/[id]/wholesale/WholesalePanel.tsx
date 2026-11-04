'use client';

import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setWholesaleLink } from '@/app/studio/_actions/wholesale';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

export interface WholesalePanelProps {
  restaurantId: string;
  /** The saved address of the company's own system; null before one is set. */
  adminUrl: string | null;
  /** The ids Core knows the company by, for the person who installs its copy: the `wholesale.panel.<key>` label names each. */
  facts: Array<{ key: 'coreBusinessId' | 'coreApplicationId'; value: string }>;
}

/** The Wholesale tab: the address of the company's own system with Save, the ids to install it with, and "Open Wholesale". */
export function WholesalePanel({ restaurantId, adminUrl, facts }: WholesalePanelProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [draft, setDraft] = useState(adminUrl ?? '');
  const [saving, startSaving] = useTransition();
  const [failure, setFailure] = useState<DescribedFailure | null>(null);

  const changed = draft.trim() !== (adminUrl ?? '');
  const save = () =>
    startSaving(async () => {
      const result = await settle(() => setWholesaleLink({ restaurantId, adminUrl: draft }));
      if (!result.ok) return setFailure(describeFailure(t, locale, result.error));
      setFailure(null);
      toast.success(t('wholesale.panel.saved'));
      router.refresh();
    });

  const fieldError = failure?.fields.adminUrl;
  const generalMessage = failure && Object.keys(failure.fields).length === 0 ? failure.message : null;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section aria-labelledby="wholesale-system" className="flex flex-col gap-4">
        <h2 id="wholesale-system" className="text-md font-semibold text-text">
          {t('wholesale.panel.system')}
        </h2>
        <p className="max-w-[72ch] text-sm text-muted">{t('wholesale.panel.intro')}</p>
        <Field label={t('wholesale.panel.adminUrl')} hint={t('wholesale.panel.adminUrlHint')} error={fieldError}>
          <Input dir="ltr" inputMode="url" value={draft} maxLength={300} disabled={saving} onChange={(event) => setDraft(event.target.value)} />
        </Field>
        {generalMessage && <Alert tone="danger">{generalMessage}</Alert>}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={save} disabled={!changed || saving} pending={saving}>
            {t('wholesale.panel.save')}
          </Button>
          {adminUrl ? (
            // A plain link, not next/link: a prefetch must never run the handoff's Route Handler.
            <a href={`/studio/wholesale/open/${restaurantId}`} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary')}>
              <ExternalLink aria-hidden />
              {t('wholesale.open')}
            </a>
          ) : (
            <span className="text-sm text-muted">{t('wholesale.open.none')}</span>
          )}
        </div>
      </section>

      <section aria-labelledby="wholesale-core" className="flex flex-col gap-4 border-t border-line pt-6">
        <h2 id="wholesale-core" className="text-md font-semibold text-text">
          {t('wholesale.panel.core')}
        </h2>
        <p className="max-w-[72ch] text-sm text-muted">{t('wholesale.panel.coreHint')}</p>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.key} className="flex flex-col gap-0.5">
              <dt className="text-sm text-muted">{t(`wholesale.panel.${fact.key}`)}</dt>
              <dd dir="ltr" className="break-all text-start font-mono text-sm text-text">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
