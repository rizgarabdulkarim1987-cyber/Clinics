import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { invoke, query, SIGN_IN_PATH, TWO_FACTOR_SETUP_PATH } from '@/server/studio/framework/invoke';
import { applyAccountRecurring } from '@/server/studio/actions/accounts';
import { accountsBook } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { AgencyBook } from './_ui/AgencyBook';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('accounts.title') };
}

/** Today in Baghdad, `YYYY-MM-DD`: what a new movement is dated and what month the screen opens on. */
const todayInBaghdad = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());

/** The agency's books: one screen, for Super Admins (anyone else gets the not-found page). */
export default async function AgencyPage() {
  const actor = await getActor();
  if (!actor) redirect(`${SIGN_IN_PATH}?next=${encodeURIComponent('/agency')}`);
  if (actor.isSuperAdmin && !actor.twoFactorEnabled) redirect(TWO_FACTOR_SETUP_PATH);
  if (!actor.isSuperAdmin) notFound();

  // Recurring expenses that have come due are posted now (a month already posted is skipped), so the book below includes them.
  await invoke(applyAccountRecurring, {});
  const book = await query(accountsBook, {});
  return <AgencyBook book={book} today={todayInBaghdad()} userName={actor.name} appearance={actor.appearance ?? null} />;
}
