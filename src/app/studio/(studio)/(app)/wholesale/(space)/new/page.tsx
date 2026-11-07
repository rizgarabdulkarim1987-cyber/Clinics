import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { newRestaurantAccess } from '@/server/studio/queries/restaurants';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { CreateRestaurantForm } from '../../../restaurants/RestaurantForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('wholesale.new') };
}

/**
 * A new wholesale company: the create form fixed on the Wholesale sector, with the way back to the Wholesale list. A wholesale company has
 * no menu plan, so no plan names are read.
 */
export default async function NewWholesaleCompanyPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  await query(newRestaurantAccess, {});
  const t = getStudioTranslator(actor.locale);

  return (
    <>
      <PageHeader
        above={
          <Link href="/studio/wholesale" className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text">
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
            {t('wholesale.title')}
          </Link>
        }
        title={t('wholesale.new')}
        description={t('wholesale.newDescription')}
      />
      <div className="px-8 pb-2">
        <CreateRestaurantForm initialSector="WHOLESALE" space="wholesale" />
      </div>
    </>
  );
}
