import { Plus, Warehouse } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { wholesaleList } from '@/server/studio/queries/wholesale';
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
  return { title: getStudioTranslator(await requestStudioLocale())('wholesale.title') };
}

const NEW_COMPANY = '/studio/wholesale/new';

/**
 * The wholesale companies on the platform, the way the Retail page is for shops: every WHOLESALE-sector business with its
 * status, its Wholesale subscription and whether the address of its own Wholesale system is set. `?unlinked=1` keeps the
 * companies with no address yet. It is the Wholesale space's list: each row opens the company's Wholesale tab there. Super
 * Admins read it; anyone else gets the not-found page.
 */
export default async function WholesalePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const unlinkedOnly = (await searchParams).unlinked === '1';
  const { rows } = await query(wholesaleList, { unlinkedOnly });

  const newCompany = (
    <Link href={NEW_COMPANY} className={buttonClasses('primary')}>
      <Plus aria-hidden />
      {t('wholesale.new')}
    </Link>
  );
  const filters = [
    { id: 'all', href: '/studio/wholesale', label: t('wholesale.filter.all'), current: !unlinkedOnly },
    { id: 'unlinked', href: '/studio/wholesale?unlinked=1', label: t('wholesale.filter.unlinked'), current: unlinkedOnly },
  ];

  return (
    <>
      <PageHeader title={t('wholesale.title')} description={t('wholesale.description')} actions={rows.length > 0 || unlinkedOnly ? newCompany : undefined} />
      <div className="flex flex-col gap-4 px-8 pb-10">
        <nav aria-label={t('wholesale.filter.label')} className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <Link
              key={filter.id}
              href={filter.href}
              aria-current={filter.current ? 'page' : undefined}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-text aria-[current=page]:border-text aria-[current=page]:text-text"
            >
              {filter.label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          unlinkedOnly ? (
            <EmptyState icon={<Warehouse aria-hidden />} title={t('wholesale.emptyUnlinkedTitle')} body={t('wholesale.emptyUnlinkedBody')} />
          ) : (
            <EmptyState icon={<Warehouse aria-hidden />} title={t('wholesale.emptyTitle')} body={t('wholesale.emptyBody')} action={newCompany} />
          )
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-start text-sm">
              <caption className="sr-only">{t('wholesale.caption')}</caption>
              <thead className="border-b border-line bg-surface-muted text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('wholesale.name')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('wholesale.status')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('wholesale.subscription')}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t('wholesale.system')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <Link href={businessPath('WHOLESALE', row.id, 'wholesale')} className="font-medium text-text underline-offset-2 hover:underline">
                        {row.name}
                      </Link>
                      <p className="text-xs text-muted">{formatDate(row.createdAt.toISOString(), actor.locale)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <RestaurantStatusBadge status={row.status} t={t} />
                    </td>
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
                    <td className="min-w-48 px-4 py-3">
                      <StatusBadge tone={row.hasAddress ? 'success' : 'neutral'}>{t(row.hasAddress ? 'wholesale.system.set' : 'wholesale.system.missing')}</StatusBadge>
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
