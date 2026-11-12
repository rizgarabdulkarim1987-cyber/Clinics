import type { Metadata } from 'next';
import { ArrowDownLeft, ArrowUpRight, HandCoins, History, Printer, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { repAccountsQuery } from '@/server/wholesale/queries/treasury';
import { getStudioTranslator } from '@/studio/messages';
import { HeaderLink, PageHeader } from '../../_ui/PageHeader';
import { ReceiveFromRepForm } from '../../_ui/ReceiveFromRepForm';
import { Chip, Fold } from '../../_ui/Ui';
import { moveLabel } from '../../_ui/repMoves';

export const metadata: Metadata = { title: 'Reps' };

const money = (v: string | number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

/** The reps' section: the cash each one holds, what he sold and received, taking his cash, and the printed report. */
export default async function RepsPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const reps = await queryWh(repAccountsQuery, {});
  const totals = new Map<string, number>();
  for (const r of reps) for (const c of r.custody) totals.set(c.currency, (totals.get(c.currency) ?? 0) + Number(c.balance));
  return (
    <>
      <PageHeader
        icon={Users}
        tone="teal"
        title={t('wh.reps.title')}
        description={t('wh.reps.description')}
        actions={
          <HeaderLink href="/wholesale/reps/print">
            <Printer aria-hidden className="me-1.5 size-4" />
            {t('wh.reps.printAll')}
          </HeaderLink>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        {reps.length > 0 && (
          <section className="rounded-2xl border border-line bg-wh-teal-wash/50 p-4">
            <p className="text-sm font-medium text-wh-teal">{t('wh.reps.total')}</p>
            <div className="mt-1 flex flex-wrap gap-x-8 gap-y-1">
              {totals.size === 0 ? (
                <p className="text-xl font-semibold tabular-nums">0</p>
              ) : (
                [...totals].map(([cur, v]) => (
                  <p key={cur} className="text-xl font-semibold tabular-nums" dir="ltr">
                    {money(v)} <span className="text-sm font-medium text-muted">{cur}</span>
                  </p>
                ))
              )}
            </div>
          </section>
        )}
        {reps.length === 0 && <p className="rounded-lg border border-line bg-raised px-4 py-6 text-center text-base text-muted">{t('wh.reps.none')}</p>}
        <div className="grid gap-4 xl:grid-cols-2">
          {reps.map((r) => {
            const collected = r.moves.filter((m) => m.side === 'DR').length;
            return (
              <section key={r.repId} className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-4 shadow-[0_1px_2px_rgb(15_42_74/0.06)]">
                <div className="flex items-center gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-wh-teal-wash text-lg font-semibold text-wh-teal" aria-hidden>
                    {(r.name.trim()[0] ?? '?').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-md font-semibold" dir="auto">
                      {r.name}
                    </h2>
                    <p className="text-sm text-muted">{t('wh.reps.holds')}</p>
                  </div>
                  <Link href={`/wholesale/reps/print?rep=${r.repId}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-sm font-medium hover:bg-hover" aria-label={t('wh.reps.print')}>
                    <Printer aria-hidden className="size-4" />
                    <span className="hidden sm:inline">{t('wh.reps.print')}</span>
                  </Link>
                </div>
                <div className="flex flex-wrap gap-x-8 gap-y-1 rounded-xl bg-hover px-4 py-3">
                  {r.custody.length === 0 ? (
                    <p className="text-xl font-semibold tabular-nums text-muted">0</p>
                  ) : (
                    r.custody.map((c) => (
                      <p key={c.currency} className="text-xl font-semibold tabular-nums" dir="ltr">
                        {money(c.balance)} <span className="text-sm font-medium text-muted">{c.currency}</span>
                      </p>
                    ))
                  )}
                </div>
                <Fold icon={HandCoins} tone="green" title={t('wh.reps.receive')} hint={t('wh.reps.receiveHint')} open={r.custody.some((c) => Number(c.available) > 0)}>
                  <ReceiveFromRepForm repId={r.repId} available={r.custody.filter((c) => Number(c.available) > 0).map((c) => ({ currency: c.currency, available: c.available }))} />
                </Fold>
                <Fold icon={History} tone="blue" title={t('wh.reps.statement')} hint={collected > 0 ? t('wh.reps.statementHint') : undefined}>
                  {r.moves.length === 0 ? (
                    <p className="text-base text-muted">{t('wh.reps.noMoves')}</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-line">
                      {r.moves.map((m, i) => (
                        <li key={`${m.number}-${i}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                          <Chip icon={m.side === 'DR' ? ArrowDownLeft : ArrowUpRight} tone={m.side === 'DR' ? 'green' : 'amber'} size="size-8" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base" dir="auto">
                              {m.sourceType === 'SALE' ? (
                                <Link href={`/wholesale/sales/${m.sourceId}`} className="underline underline-offset-2">
                                  {moveLabel(m, t)}
                                </Link>
                              ) : (
                                moveLabel(m, t)
                              )}
                            </p>
                            <p className="text-sm text-muted tabular-nums" dir="ltr">
                              {m.date}
                            </p>
                          </div>
                          <span className={`shrink-0 text-base font-semibold tabular-nums ${m.side === 'DR' ? 'text-wh-green' : 'text-wh-amber'}`} dir="ltr">
                            {m.side === 'DR' ? '+' : '−'}
                            {money(m.amount)} {m.currency}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Fold>
              </section>
            );
          })}
        </div>
        <UserRound className="hidden" aria-hidden />
      </div>
    </>
  );
}
