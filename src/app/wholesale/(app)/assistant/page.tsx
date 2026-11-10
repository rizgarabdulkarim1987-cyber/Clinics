import type { Metadata } from 'next';
import { ASSISTANT_MONTHLY_LIMIT } from '@/server/domain/wholesale/assistant';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { assistantUsageQuery } from '@/server/wholesale/queries/reports';
import { getStudioTranslator } from '@/studio/messages';
import { PageHeader } from '../../_ui/PageHeader';
import { AssistantChat } from '../../_ui/AssistantChat';
import { InvoicePhoto } from '../../_ui/InvoicePhoto';

export const metadata: Metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const { used } = await queryWh(assistantUsageQuery);
  return (
    <>
      <PageHeader title={t('wh.assistant.title')} description={t('wh.assistant.description')} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        <InvoicePhoto limit={ASSISTANT_MONTHLY_LIMIT} used={used} />
        <AssistantChat limit={ASSISTANT_MONTHLY_LIMIT} used={used} />
      </div>
    </>
  );
}
