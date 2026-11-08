'use client';

import { useState, useTransition } from 'react';
import { askAssistant } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert, Button, Input } from '@/studio/ui';

type Table = { tool: string; title: string; rows: { label: string; value: string }[] };
type Answer = { text: string | null; tables: Table[]; period: { from: string; to: string } | null; degraded?: string; used: number };
type Turn = { question: string; answer: Answer };

const STARTERS = ['cash', 'debts', 'profit', 'sales', 'stock', 'pending'] as const;

/** Ask the accounting assistant. Each answer is the tables from the books, with the model's short phrasing when it passed the checks. */
export function AssistantChat({ limit, used }: { limit: number; used: number }) {
  const t = useT();
  const { locale } = useLocale();
  const [pending, start] = useTransition();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(used);

  const ask = (q: string) => {
    const text = q.trim();
    if (!text || pending) return;
    setError(null);
    start(async () => {
      const result = await settle(() => askAssistant({ question: text }));
      if (result.ok) {
        const answer = result.data as Answer;
        setTurns((prev) => [{ question: text, answer }, ...prev]);
        setCount(answer.used);
        setQuestion('');
      } else setError(describeFailure(t, locale, result.error).message);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <div className="flex gap-2">
          <Input name="question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('wh.assistant.placeholder')} maxLength={1000} className="flex-1" aria-label={t('wh.assistant.placeholder')} />
          <Button type="submit" variant="primary" pending={pending}>
            {t('wh.assistant.ask')}
          </Button>
        </div>
        <ul className="flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <li key={s}>
              <button type="button" disabled={pending} onClick={() => ask(t(`wh.assistant.q.${s}`))} className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-60">
                {t(`wh.assistant.q.${s}`)}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">{t('wh.assistant.used', { used: count, limit })}</p>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
      <ul className="flex flex-col gap-4" aria-live="polite">
        {turns.map((turn, i) => (
          <li key={`${turns.length - i}`} className="flex flex-col gap-3 rounded-md border border-line bg-raised p-4">
            <p className="text-sm text-muted">{turn.question}</p>
            {turn.answer.text && <p className="text-base">{turn.answer.text}</p>}
            {!turn.answer.text && turn.answer.degraded && <p className="text-sm text-muted">{t(`wh.assistant.degraded.${turn.answer.degraded}`)}</p>}
            {turn.answer.period && (
              <p className="text-sm text-muted" dir="ltr">
                {turn.answer.period.from} → {turn.answer.period.to}
              </p>
            )}
            {turn.answer.tables.map((table) => (
              <section key={table.tool} className="flex flex-col gap-1">
                <h3 className="text-base font-semibold">{table.title}</h3>
                <dl className="flex flex-col gap-1">
                  {table.rows.map((r, j) => (
                    <div key={j} className="flex items-center justify-between gap-3 border-t border-line pt-1 first:border-0 first:pt-0">
                      <dt className="text-base">{r.label}</dt>
                      <dd className="tabular-nums" dir="ltr">
                        {r.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
