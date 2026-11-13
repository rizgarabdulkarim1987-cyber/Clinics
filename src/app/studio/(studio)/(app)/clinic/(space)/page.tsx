import { Plus, Stethoscope } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { listClinics } from '@/server/studio/queries/clinics';
import { SUBSCRIPTION_TONE } from '@/studio/billing';
import { formatDate } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { businessPath } from '@/studio/spaces';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { RestaurantStatusBadge } from '../../restaurants/RestaurantStatusBadge';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('clinic.title') };
}

const NEW_CLINIC = '/studio/clinic/new';

/**
 * The clinics on the platform: every CLINIC-sector business with its status, its branches and its Clinics subscription.
 * It is the Clinics space's list: each row opens the clinic's page there. Super Admins read it; anyone else gets the
 * not-found page (the space's layout).
 */
export default async function ClinicsPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const { rows } = await query(listClinics, {});

  const newClinic = (
    <Link href={NEW_CLINIC} className={buttonClasses('primary')}>
      <Plus aria-hidden />
      {t('clinic.new')}
    </Link>
  );

  return (
    <>
      <PageHeader title={t('clinic.title')} description={t('clinic.description')} actions={rows.length > 0 ? newClinic : undefined} />
      <div className="flex flex-col gap-4 px-8 pb-10">
        {rows.length === 0 ? (
          <EmptyState icon={<Stethoscope aria-hidden />} title={t('clinic.emptyTitle')} body={t('clinic.emptyBody')} action={newClinic} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-start text-sm">
              <caption className="sr-only">{t('clinic.caption')}</caption>
              <thead className="border-b border-line bg-surface-muted text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('clinic.name')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('clinic.status')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('clinic.branches')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('clinic.subscription')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <Link href={businessPath('clinic', row.id)} className="font-medium text-text underline-offset-2 hover:underline">
                        {row.name}
                      </Link>
                      <p className="text-xs text-muted">{formatDate(row.createdAt.toISOString(), actor.locale)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <RestaurantStatusBadge status={row.status} t={t} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.branches}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge tone={row.subscription ? SUBSCRIPTION_TONE[row.subscription.status] : undefined}>
                          {t(`billing.status.${row.subscription?.status ?? 'NONE'}`)}
                        </StatusBadge>
                        {row.subscription && (
                          <span className="whitespace-nowrap text-xs text-muted">{row.subscription.planName?.[actor.locale] ?? row.subscription.planCode}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
