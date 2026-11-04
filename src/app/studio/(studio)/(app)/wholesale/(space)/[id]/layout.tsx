import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BusinessLayout } from '../../../restaurants/[id]/BusinessLayout';
import { loadRestaurant } from '../../../restaurants/[id]/load';

/** The frame of one wholesale company. A business of another project is not found here. */
export default async function WholesaleCompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const restaurant = await loadRestaurant((await params).id);
  if (restaurant.sector !== 'WHOLESALE') notFound();
  return (
    <BusinessLayout space="wholesale" params={params}>
      {children}
    </BusinessLayout>
  );
}
