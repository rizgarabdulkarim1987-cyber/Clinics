import { Banknote, HandCoins, Store, UserRound, Wallet } from 'lucide-react';
import { Chip, type Tone } from './Ui';

type Totals = Record<string, string>;
export type RepAccount = {
  userId: string;
  name: string;
  custody: { currency: string; balance: string; reserved: string }[];
  owed: Totals;
  debtors: { id: string; name: string; totals: Totals }[];
  collected: Totals;
  recent: { id: string; customer: string; amount: string; currency: string; date: string }[];
};

const fmt = (v: string | number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const line = (by: Totals) => {
  const parts = Object.entries(by).filter(([, v]) => Number(v) !== 0);
  return parts.length === 0 ? '0' : parts.map(([c, v]) => `${fmt(v)} ${c}`).join(' · ');
};

function Tile({ icon, tone, label, value, strong }: { icon: typeof Wallet; tone: Tone; label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-bg p-2.5">
      <Chip icon={icon} tone={tone} size="size-10" />
      <div className="min-w-0">
        <div className="text-sm leading-tight text-muted">{label}</div>
        <div className={`text-lg tabular-nums ${strong ? 'font-bold' : 'font-semibold'}`} dir="ltr">
          {value}
        </div>
      </div>
    </div>
  );
}

/** One card per rep: the cash he holds, what his shops owe, what he collected, and the latest repayments. */
export function RepAccounts({ reps, t }: { reps: RepAccount[]; t: (k: string) => string }) {
  if (reps.length === 0) return <p className="rounded-xl border border-line bg-raised p-6 text-center text-base text-muted">{t('wh.rep.none')}</p>;
  return (
    <div className={`grid items-start gap-4 ${reps.length > 1 ? "xl:grid-cols-2" : ""}`}>
      {reps.map((r) => (
        <section key={r.userId} className="rounded-xl border border-line bg-raised shadow-[0_1px_2px_rgb(15_42_74/0.06)]">
          <h2 className="flex items-center gap-2.5 border-b border-line px-3 py-2.5 text-md font-semibold">
            <Chip icon={UserRound} tone="teal" size="size-8" />
            <span dir="auto">{r.name}</span>
          </h2>
          <div className="grid gap-2 p-3 sm:grid-cols-3">
            <Tile icon={Wallet} tone="rose" label={t('wh.rep.custody')} value={r.custody.length === 0 ? '0' : r.custody.map((c) => `${fmt(c.balance)} ${c.currency}`).join(' · ')} strong />
            <Tile icon={HandCoins} tone="amber" label={t('wh.rep.owed')} value={line(r.owed)} strong />
            <Tile icon={Banknote} tone="green" label={t('wh.rep.collected')} value={line(r.collected)} />
          </div>
          <div className="grid gap-4 border-t border-line p-3 md:grid-cols-2">
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
                <Store aria-hidden className="size-4 text-wh-amber" />
                {t('wh.rep.debtors')}
                <span className="rounded-full bg-hover px-2 text-sm tabular-nums">{r.debtors.length}</span>
              </h3>
              {r.debtors.length === 0 ? (
                <p className="text-base text-muted">{t('wh.rep.noDebts')}</p>
              ) : (
                <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto">
                  {r.debtors.map((d) => (
                    <li key={d.id} className="flex items-baseline justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate text-base" dir="auto">
                        {d.name}
                      </span>
                      <span className="shrink-0 text-base font-semibold tabular-nums" dir="ltr">
                        {line(d.totals)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
                <Banknote aria-hidden className="size-4 text-wh-green" />
                {t('wh.rep.recent')}
              </h3>
              {r.recent.length === 0 ? (
                <p className="text-base text-muted">{t('wh.rep.noRecent')}</p>
              ) : (
                <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto">
                  {r.recent.map((p) => (
                    <li key={p.id} className="flex items-baseline gap-3 py-1.5">
                      <span className="shrink-0 text-sm tabular-nums text-muted" dir="ltr">
                        {p.date.slice(5)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-base" dir="auto">
                        {p.customer}
                      </span>
                      <span className="shrink-0 text-base font-semibold tabular-nums text-wh-green" dir="ltr">
                        +{fmt(p.amount)} {p.currency}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
