import { redirect } from 'next/navigation';
import { getClAccess } from '@/server/clinic/access';
import { spaceBase } from '@/server/clinic/space';

/** `/clinic` (and `/beauty`) has nothing to show: it sends each person to the place their state calls for. */
export default async function ClinicEntryPage() {
  const { entry, space } = await getClAccess();
  const base = spaceBase(space);
  switch (entry.kind) {
    case 'signIn':
      redirect(entry.to);

    case 'noClinic':
      redirect(`${base}/no-clinic`);

    case 'choose':
      redirect(`${base}/select`);

    case 'closed':
      redirect(`${base}/closed`);

    case 'open':
      redirect(`${base}/home`);
  }
}
