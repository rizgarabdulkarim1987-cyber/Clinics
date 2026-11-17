import { redirect } from 'next/navigation';
import { getClAccess } from '@/server/clinic/access';

/** `/clinic` has nothing to show: it sends each person to the place their state calls for. */
export default async function ClinicEntryPage() {
  const { entry } = await getClAccess();
  switch (entry.kind) {
    case 'signIn':
      redirect(entry.to);
     
    case 'noClinic':
      redirect('/clinic/no-clinic');
     
    case 'choose':
      redirect('/clinic/select');
     
    case 'closed':
      redirect('/clinic/closed');
     
    case 'open':
      redirect('/clinic/home');
  }
}
