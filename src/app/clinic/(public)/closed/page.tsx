import { redirect } from 'next/navigation';
import { getClAccess } from '@/server/clinic/access';
import { spaceBase } from '@/server/clinic/space';
import { clinicTranslator } from '@/server/clinic/translator';
import { SignOutButton } from '../../SignOutButton';

/** The clinic is suspended or archived: nothing opens, and the person is told why. */
export default async function ClosedPage() {
  const { entry, space } = await getClAccess();
  if (entry.kind === 'signIn') redirect(entry.to);
  if (entry.kind !== 'closed') redirect(spaceBase(space));
  const t = await clinicTranslator();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{entry.member.clinicName}</h1>
        <p className="text-muted">{t(`clinic.app.closed.${entry.reason}`)}</p>
      </div>
      <SignOutButton />
    </main>
  );
}
