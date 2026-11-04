import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { appPlansList } from '@/server/studio/queries/app-plans';
import { billingOverview } from '@/server/studio/queries/billing';
import { getPlans } from '@/server/studio/queries/plans';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { AppPlansEditor } from '../../../billing/plans/AppPlansEditor';
import { BillingSettings } from '../../../settings/billing/BillingSettings';

export async function generateMetadata(): Promise<Metadata> {
  const t = getStudioTranslator(await requestStudioLocale());
  return { title: `${t('nav.settings')} · ${t('hub.wholesale')}` };
}

/**
 * Wholesale's own settings, apart from the other projects: what the Wholesale product costs and the Wholesale plans with the limits
 * each sets (once the `?app=wholesale` tab of Billing → Plans). Super Admins read it; the platform owner changes it.
 */
export default async function WholesaleSettingsPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const [overview, plans, appPlans] = await Promise.all([
    query(billingOverview, { space: 'wholesale' }),
    query(getPlans, {}),
    query(appPlansList, { applicationId: 'wholesale' }),
  ]);
  const planNames = Object.fromEntries(Object.entries(plans.plans).map(([code, plan]) => [code, plan.names]));

  return (
    <>
      <PageHeader title={t('nav.settings')} description={t('appPlans.wholesale.description')} />
      <div className="flex flex-col gap-10 px-8 py-6 pb-10">
        <BillingSettings key={JSON.stringify(overview.applications)} products={overview.applications} planNames={planNames} canEdit={overview.canEdit} />
        <section aria-label={t('appPlans.wholesale.title')} className="flex flex-col gap-4">
          <h2 className="text-md font-semibold text-text">{t('appPlans.wholesale.title')}</h2>
          <AppPlansEditor applicationId="wholesale" plans={appPlans.plans} canEdit={appPlans.canEdit} />
        </section>
      </div>
    </>
  );
}
