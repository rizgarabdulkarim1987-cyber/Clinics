import type { Metadata } from 'next';
import { ChevronLeft, FileSpreadsheet, Handshake, Plus } from 'lucide-react';
import Link from 'next/link';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { agencyOrdersQuery } from '@/server/wholesale/queries/agency';
import { customersQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { Fold, Row } from '../../_ui/Ui';
import { STATUS_TONE } from '../../_ui/agencyTone';
import { NewAgencyForm } from '../../_ui/AgencyForms';
import { HeaderLink, PageHeader } from '../../_ui/PageHeader';

export const metadata: Metadata = { title: 'Agency orders' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
/** Orders the company handles for other companies: each with what they paid in advance and what is still owed. */
export default async function AgencyPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const [orders, customers] = await Promise.all([queryWh(agencyOrdersQuery), queryWh(customersQuery)]);
  const principals = customers.filter((c) => c.active !== false).map((c) => ({ id: c.id, label: c.name }));
  return (
    <>
      <PageHeader
        icon={Handshake}
        tone="violet"
        title={t('wh.agency.title')}
        description={t('wh.agency.description')}
        actions={
          <HeaderLink href="/wholesale/export?kind=agency">
            <FileSpreadsheet aria-hidden className="me-1.5 size-4" />
            Excel
          </HeaderLink>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-6 md:px-6">
        <Fold icon={Plus} tone="violet" title={t('wh.agency.new')} open={orders.length === 0}>
          <NewAgencyForm principals={principals} />
        </Fold>
        {orders.length === 0 ? (
          <p className="rounded-lg border border-line bg-raised px-4 py-6 text-center text-base text-muted">{t('wh.agency.none')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/wholesale/agency/${o.id}`} className="block rounded-xl border border-line bg-raised p-3 shadow-[0_1px_2px_rgb(15_42_74/0.06)] hover:bg-hover">
                  <Row
                    icon={Handshake}
                    tone={STATUS_TONE[o.status] ?? 'blue'}
                    end={<ChevronLeft aria-hidden className="size-4 text-muted ltr:rotate-180" />}
                  >
                    <p className="truncate text-base font-semibold" dir="auto">
                      {o.title}
                    </p>
                    <p className="truncate text-sm text-muted" dir="auto">
                      #{o.number} · {o.principal.name} · {t(`wh.agency.status.${o.status}`)}
                    </p>
                  </Row>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-muted">{t('wh.agency.agreedTotal')}</dt>
                      <dd className="font-medium tabular-nums" dir="ltr">
                        {money(o.agreedTotal)} {o.currency}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t('wh.agency.held')}</dt>
                      <dd className="font-medium tabular-nums" dir="ltr">
                        {money(o.balance.advanceHeld)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t('wh.agency.owed')}</dt>
                      <dd className="font-medium tabular-nums" dir="ltr">
                        {money(o.balance.receivable)}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
