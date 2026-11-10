import type { Metadata } from 'next';
import { HandCoins, History, UserRound, Wallet } from 'lucide-react';
import Link from 'next/link';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { repAccountsQuery } from '@/server/wholesale/queries/treasury';
import { getStudioTranslator } from '@/studio/messages';
import { PageHeader } from '../../_ui/PageHeader';
import { ReceiveFromRepForm } from '../../_ui/ReceiveFromRepForm';
import { Fold, Row } from '../../_ui/Ui';

export const metadata: Metadata = { title: 'Reps' };

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

/** What each rep holds (collected and not yet handed in), what he sold and received, and the button to take his cash. */
export default async function RepsPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const reps = await queryWh(repAccountsQuery);
  return (
    <>
      <PageHeader icon={UserRound} tone="teal" title={t('wh.reps.title')} description={t('wh.reps.description')} />
      <div className="flex flex-col gap-3 px-4 pb-6 md:px-6">
        {reps.length === 0 && <p className="rounded-lg border border-line bg-raised px-4 py-6 text-center text-base text-muted">{t('wh.reps.none')}</p>}
        {reps.map((r) => (
          <section key={r.repId} className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-3 shadow-[0_1px_2px_rgb(15_42_74/0.06)]">
            <Row
              icon={UserRound}
              tone="teal"
              end={
                <div className="flex flex-col items-end gap-0.5 tabular-nums" dir="ltr">
                  {r.custody.length === 0 ? <span className="text-base text-muted">0</span> : r.custody.map((c) => <span key={c.currency} className="text-md font-semibold">{money(c.balance)} {c.currency}</span>)}
                </div>
              }
            >
              <p className="truncate text-md font-semibold" dir="auto">{r.name}</p>
              <p className="text-sm text-muted">{t('wh.reps.holds')}</p>
            </Row>
            <Fold icon={HandCoins} tone="green" title={t('wh.reps.receive')} hint={t('wh.reps.receiveHint')}>
              <ReceiveFromRepForm repId={r.repId} available={r.custody.filter((c) => Number(c.available) > 0).map((c) => ({ currency: c.currency, available: c.available }))} />
            </Fold>
            <Fold icon={History} tone="blue" title={t('wh.reps.statement')} hint={t('wh.reps.statementHint')}>
              {r.moves.length === 0 ? (
                <p className="text-base text-muted">{t('wh.reps.noMoves')}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {r.moves.map((m, i) => (
                    <li key={`${m.number}-${i}`}>
                      <Row
                        icon={m.side === 'DR' ? Wallet : HandCoins}
                        tone={m.side === 'DR' ? 'green' : 'amber'}
                        end={
                          <span className={`text-base font-semibold tabular-nums ${m.side === 'DR' ? 'text-wh-green' : 'text-wh-amber'}`} dir="ltr">
                            {m.side === 'DR' ? '+' : '−'}{money(m.amount)} {m.currency}
                          </span>
                        }
                      >
                        <p className="truncate text-base" dir="auto">
                          {m.sourceType === 'SALE' ? (
                            <Link href={`/wholesale/sales/${m.sourceId}`} className="underline">{m.memo}</Link>
                          ) : (
                            m.memo
                          )}
                        </p>
                        <p className="text-sm text-muted tabular-nums" dir="ltr">{m.date}</p>
                      </Row>
                    </li>
                  ))}
                </ul>
              )}
            </Fold>
          </section>
        ))}
      </div>
    </>
  );
}
