import { redirect } from 'next/navigation';

/** The pharmacy plans moved into the Pharmacy space's own settings, and the Retail plans (`?app=retail`) into Retail's. */
export default async function AppPlansRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if ((await searchParams).app === 'retail') redirect('/studio/retail/settings');
  if ((await searchParams).app === 'wholesale') redirect('/studio/wholesale/settings');
  redirect('/studio/pharmacy/settings');
}
