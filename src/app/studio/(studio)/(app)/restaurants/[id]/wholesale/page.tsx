import type { Metadata } from 'next';
import { getActor } from '@/server/studio/auth/actor';
import { query } from '@/server/studio/framework/invoke';
import { wholesaleDetail } from '@/server/studio/queries/wholesale';
import { getStudioTranslator } from '@/studio/messages';
import { loadRestaurant } from '../load';
import { WholesalePanel } from './WholesalePanel';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, actor] = [await params, await getActor()];
  const restaurant = await loadRestaurant(id);
  return { title: `${getStudioTranslator(actor?.locale ?? 'en')('restaurants.tabs.wholesale')} · ${restaurant.name}` };
}

/**
 * A wholesale company's own Wholesale system: the address it runs at, the ids Core knows the company by (for whoever installs
 * its copy) and "Open Wholesale". Super Admins only (`wholesale.detail` needs `platform.settings`); anyone else, and any business
 * that is no wholesale company, gets the not-found page.
 */
export default async function RestaurantWholesalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const restaurant = await loadRestaurant(id);
  const detail = await query(wholesaleDetail, { restaurantId: restaurant.id });

  return (
    <div className="px-8 py-6">
      <WholesalePanel
        restaurantId={detail.id}
        adminUrl={detail.adminUrl}
        facts={[
          { key: 'coreBusinessId', value: detail.coreBusinessId },
          { key: 'coreApplicationId', value: detail.coreApplicationId },
        ]}
      />
    </div>
  );
}
