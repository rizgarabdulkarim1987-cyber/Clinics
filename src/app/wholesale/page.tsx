import { notFound, redirect } from 'next/navigation';
import { getWhAccess, WH_SIGN_IN } from '@/server/wholesale/access';

/**
 * `/wholesale` itself has nothing to show: a person who is not signed in goes to the shared sign-in, a person with no
 * wholesale company gets "not found" (never back to the sign-in, which would loop), and anyone else goes to the home.
 */
export default async function WholesaleEntryPage() {
  const access = await getWhAccess();
  if (!access.signedIn) redirect(WH_SIGN_IN);
  if (!access.actor) notFound();
  redirect('/wholesale/desk');
}
