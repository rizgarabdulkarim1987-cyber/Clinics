import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getWhAccess, WH_SIGN_IN } from '@/server/wholesale/access';
import { getStudioTranslator } from '@/studio/messages';
import { Alert } from '@/studio/ui';
import { Shell } from '../_ui/Shell';

/**
 * Every Wholesale screen sits in this frame. Nobody signed in goes to the shared sign-in; a person with no wholesale company
 * gets a 404. A closed company shows its reason instead of the screen; a read-only one shows the screen under a notice.
 * Pages never rely on this gate for data: they read through `wh` queries, whose framework checks run on every call.
 */
export default async function WholesaleAppLayout({ children }: { children: ReactNode }) {
  const access = await getWhAccess();
  if (!access.signedIn) redirect(WH_SIGN_IN);
  if (!access.actor || !access.gate) notFound();
  const { actor, gate } = access;
  const t = getStudioTranslator(actor.locale);
  if (gate.state === 'closed') {
    return (
      <Shell actor={actor} t={t}>
        <div className="p-8">
          <Alert tone="danger">
            <strong>{t('wh.state.closed')}</strong> {t(`wh.state.closed.${gate.reason}`)}
          </Alert>
        </div>
      </Shell>
    );
  }
  const notice = gate.state === 'readOnly' ? <Alert tone="neutral" className="m-4">{t('wh.state.readOnly')}</Alert> : null;
  return (
    <Shell actor={actor} notice={notice} t={t}>
      {children}
    </Shell>
  );
}
