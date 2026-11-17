import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireClScreen } from '@/server/clinic/access';
import { clinicTranslator } from '@/server/clinic/translator';
import { navFor } from '@/server/clinic/roles';
import { spaceBase } from '@/server/clinic/space';
import { SignOutButton } from '../SignOutButton';

/** The clinic app's shell: the clinic's name, the screens this role may open, and sign-out. Every page behind it has already passed its own role check. */
export default async function ClinicAppLayout({ children }: { children: ReactNode }) {
  const { member, session, space } = await requireClScreen('home');
  const t = await clinicTranslator();
  const items = navFor(member.role, spaceBase(space));
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 px-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{member.clinicName}</p>
          <p className="truncate text-sm text-muted">
            {session.name} · {t(`clinic.app.role.${member.role}`)}
          </p>
        </div>
        <SignOutButton fallback={`${spaceBase(space)}/sign-in`} />
      </header>
      <nav aria-label={t('clinic.app.nav.label')} className="flex gap-1 overflow-x-auto">
        {items.map((item) => (
          <Link key={item.screen} href={item.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-surface hover:text-text">
            {t(item.label)}
          </Link>
        ))}
      </nav>
      <main className="flex flex-1 flex-col gap-6">{children}</main>
    </div>
  );
}
