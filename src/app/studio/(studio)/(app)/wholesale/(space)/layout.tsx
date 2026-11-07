import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { SpaceWords } from '@/studio/i18n';

/**
 * The Wholesale space is for Super Admins only: anyone else gets the Studio's not-found page. The handoff to a company's own
 * system (`/studio/wholesale/open/[id]`) shares the prefix but sits outside this group; it checks for a Super Admin itself. Every client screen inside speaks the space's own words (`SpaceWords`): the shared screens
 * name no restaurant, menu, till or pharmacy here.
 */
export default async function WholesaleSpaceLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (!actor.isSuperAdmin) notFound();
  return <SpaceWords space="wholesale">{children}</SpaceWords>;
}
