import { Warehouse } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RESTAURANT_STATUSES } from '@/server/domain/restaurant-profile';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { overview } from '@/server/studio/queries/overview';
import { getStudioTranslator } from '@/studio/messages';
import { spaceT } from '@/studio/space-words';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { isolated } from '@/studio/ui/isolate';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RecentActivity, Tally } from '../../../overview/OverviewParts';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('overview.title') };
}

/** The Wholesale space's home: how many wholesale companies there are by status, and the newest activity on them. */
export default async function WholesaleOverviewPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = spaceT(getStudioTranslator(actor.locale), 'wholesale');
  const locale = actor.locale;
  const data = await query(overview, { space: 'wholesale' });
  const total = RESTAURANT_STATUSES.reduce((sum, status) => sum + data.restaurants[status], 0);

  return (
    <>
      <PageHeader title={isolated(t('overview.welcome'), { name: actor.name })} description={t('hub.wholesale')} />
      <div className="flex flex-col gap-8 px-8 pb-10">
        {total === 0 ? (
          <EmptyState
            icon={<Warehouse aria-hidden />}
            title={t('wholesale.emptyTitle')}
            body={t('wholesale.emptyBody')}
            action={
              <Link href="/studio/wholesale/new" className={buttonClasses('primary')}>
                {t('wholesale.new')}
              </Link>
            }
          />
        ) : (
          <div className="grid gap-10 xl:grid-cols-2">
            <div className="max-w-md">
              <Tally
                title={t('wholesale.caption')}
                total={total}
                locale={locale}
                parts={RESTAURANT_STATUSES.map((status) => ({
                  label: t(`status.${status.toLowerCase()}`),
                  count: data.restaurants[status],
                  href: `/studio/wholesale`,
                }))}
              />
            </div>
            {data.recentActivity && <RecentActivity rows={data.recentActivity} t={t} locale={locale} activityHref="/studio/wholesale/activity" />}
          </div>
        )}
      </div>
    </>
  );
}
