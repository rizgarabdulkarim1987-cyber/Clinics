import type { Metadata } from 'next';
import { Ban, BadgeDollarSign, CircleDollarSign, Handshake, HandCoins, History, PackageCheck, Printer, Wallet } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { agencyOrderQuery } from '@/server/wholesale/queries/agency';
import { staffQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { CancelAgencyButton, CostForm, MoneyInForm, SettleForm } from '../../../_ui/AgencyForms';
import { HeaderLink, PageHeader } from '../../../_ui/PageHeader';
import { Chip, Fold, Row, Section, type Tone } from '../../../_ui/Ui';
import { STATUS_TONE } from '../../../_ui/agencyTone';

export const metadata: Metadata = { title: 'Agency order' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
const KIND_TONE: Record<string, Tone> = { ADVANCE: 'green', COST: 'amber', COMMISSION: 'violet', APPLIED: 'teal', REFUND: 'rose', COLLECTION: 'green' };

/** One agency order: what they paid in advance, what we paid for them, our commission, what is owed, and the steps still open. */
export default async function AgencyOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const [o, staff] = await Promise.all([queryWh(agencyOrderQuery, { id }), queryWh(staffQuery, {}).catch(() => [])]);
  if (!o) notFound();
  const reps = staff.filter((s) => s.role === 'REP' && s.active).map((s) => ({ id: s.userId, label: s.name }));
  const b = o.balance;
  const isOpen = o.status === 'OPEN';
  const stat = (label: string, value: string, strong = false) => (
    <div className="rounded-lg border border-line bg-raised p-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'text-lg font-semibold' : 'text-md font-medium'}`} dir="ltr">
        {money(value)} <span className="text-sm text-muted">{o.currency}</span>
      </dd>
    </div>
  );
  return (
    <>
      <PageHeader
        icon={Handshake}
        tone={STATUS_TONE[o.status] ?? 'blue'}
        title={<span dir="auto">{o.title}</span>}
        description={`#${o.number} · ${o.principal.name} · ${t(`wh.agency.status.${o.status}`)}`}
        actions={
          <HeaderLink href={`/wholesale/agency/${o.id}/print`}>
            <Printer aria-hidden className="me-1.5 size-4" />
            {t('wh.agency.print')}
          </HeaderLink>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-6 md:px-6">
        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {stat(t('wh.agency.agreedTotal'), o.agreedTotal)}
          {stat(t('wh.agency.held'), b.advanceHeld, isOpen)}
          {stat(t('wh.agency.costs'), b.costs)}
          {stat(t('wh.agency.owed'), b.receivable, !isOpen)}
        </dl>
        {o.note && (
          <p className="rounded-lg border border-line bg-raised px-3 py-2 text-base text-muted" dir="auto">
            {o.note}
          </p>
        )}
        {isOpen && (
          <>
            <Fold icon={BadgeDollarSign} tone="green" title={t('wh.agency.advance.title')} hint={t('wh.agency.advance.hint')}>
              <MoneyInForm orderId={o.id} currency={o.currency} reps={reps} kind="advance" />
            </Fold>
            <Fold icon={HandCoins} tone="amber" title={t('wh.agency.cost.title')} hint={t('wh.agency.cost.hint')}>
              <CostForm orderId={o.id} currency={o.currency} />
            </Fold>
            <Fold icon={PackageCheck} tone="violet" title={t('wh.agency.settle.title')} hint={t('wh.agency.settle.hint')}>
              <SettleForm orderId={o.id} currency={o.currency} held={b.advanceHeld} receivable={b.receivable} />
            </Fold>
          </>
        )}
        {o.status === 'DELIVERED' && (
          <Fold icon={Wallet} tone="green" title={t('wh.agency.collect.title')} hint={t('wh.agency.collect.hint')} open>
            <MoneyInForm orderId={o.id} currency={o.currency} reps={reps} kind="collect" max={b.receivable} />
          </Fold>
        )}
        <Section icon={History} tone="blue" title={t('wh.agency.history')}>
          {o.movements.length === 0 ? (
            <p className="text-base text-muted">{t('wh.agency.empty.moves')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {o.movements.map((m) => (
                <li key={m.id}>
                  <Row
                    icon={m.kind === 'ADVANCE' || m.kind === 'COLLECTION' ? CircleDollarSign : HandCoins}
                    tone={KIND_TONE[m.kind] ?? 'blue'}
                    end={
                      <span className="text-base font-semibold tabular-nums" dir="ltr">
                        {money(m.amount)} {o.currency}
                      </span>
                    }
                  >
                    <p className="truncate text-base">{t(`wh.agency.kind.${m.kind}`)}</p>
                    <p className="truncate text-sm text-muted" dir="auto">
                      <span dir="ltr">{String(m.date).slice(0, 10)}</span>
                      {m.note ? ` · ${m.note}` : ''}
                    </p>
                  </Row>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {isOpen && Number(b.costs) === 0 && (
          <Fold icon={Ban} tone="rose" title={t('wh.agency.cancel.title')} hint={t('wh.agency.cancel.hint')}>
            <CancelAgencyButton orderId={o.id} />
          </Fold>
        )}
        <Link href="/wholesale/agency" className="inline-flex min-h-10 items-center gap-2 self-start text-base underline">
          <Chip icon={Handshake} tone="violet" size="size-7" />
          {t('wh.agency.title')}
        </Link>
      </div>
    </>
  );
}
