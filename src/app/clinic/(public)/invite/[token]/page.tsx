import { getPrisma } from '@/server/data/prisma';
import { inspectClInvitation } from '@/server/clinic/invitations';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { getStudioTranslator } from '@/studio/messages';
import { ClinicInviteForm } from './InviteForm';

/** The page an invitation's link opens, on the clinic app: nothing about the Studio is shown or needed. */
export default async function ClinicInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = getStudioTranslator(await requestClinicLocale());
  const view = await inspectClInvitation(getPrisma(), token, new Date());
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      {view.status === 'valid' ? (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">{t('clinic.app.invite.title', { clinic: view.clinicName ?? '' })}</h1>
            <p className="text-muted">{t(`clinic.app.invite.role.${view.role ?? 'OWNER'}`)}</p>
            <p className="text-muted" dir="ltr">{view.email}</p>
          </div>
          <ClinicInviteForm token={token} accountExists={view.accountExists ?? false} />
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t('clinic.app.invite.unusable')}</h1>
          <p className="text-muted">{t(`clinic.app.invite.status.${view.status}`)}</p>
        </div>
      )}
    </main>
  );
}
