import type { Metadata } from 'next';
import { ASSISTANT_MONTHLY_LIMIT } from '@/server/domain/wholesale/assistant';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { assistantUsageQuery } from '@/server/wholesale/queries/reports';
import { getStudioTranslator } from '@/studio/messages';
import { PageHeader } from '@/studio/ui';
import { AssistantChat } from '../../_ui/AssistantChat';

export const metadata: Metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const { used } = await queryWh(assistantUsageQuery);
  return (
    <>
      <PageHeader title={t('wh.assistant.title')} description={t('wh.assistant.description')} />
      <div className="px-4 pb-10 md:px-8">
        <AssistantChat limit={ASSISTANT_MONTHLY_LIMIT} used={used} />
      </div>
    </>
  );
}
