import { redirect } from 'next/navigation';

/** The pharmacy plans moved into the Pharmacy space's own settings, and the Retail plans (`?app=retail`) into Retail's (the
 * three Retail products share them; the Supermarket's settings show them). */
export default async function AppPlansRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if ((await searchParams).app === 'retail') redirect('/studio/supermarket/settings');
  if ((await searchParams).app === 'wholesale') redirect('/studio/wholesale/settings');
  if ((await searchParams).app === 'clinic') redirect('/studio/clinic/settings');
  redirect('/studio/pharmacy/settings');
}
