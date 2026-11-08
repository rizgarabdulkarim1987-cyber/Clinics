/**
 * The accounting assistant's rules (Phase 7). Pure: no database, no model.
 *
 * The code decides everything that matters. Which tables answer a question is chosen from the QUESTION's words alone
 * (never from data, never by the model); the tables are computed from the books by the report layer; the model, when
 * there is one, only phrases them and may use no figure the tables do not hold. A question that names nothing gets the
 * list of what the assistant can answer. The assistant has no write tool: nothing it does changes the books.
 */

export const ASSISTANT_TOOLS = ['cash', 'debts', 'profit', 'sales', 'stock', 'pending'] as const;
export type AssistantTool = (typeof ASSISTANT_TOOLS)[number];

/** Words that name a tool, in English, Arabic and Kurdish (Sorani). Matched as parts of words, case-insensitively. */
const WORDS: Record<AssistantTool, readonly string[]> = {
  cash: ['cash', 'box', 'money', 'treasury', 'صندوق', 'نقد', 'كاش', 'خزين', 'قاسە', 'قاسه', 'پارە', 'پاره', 'کاش'],
  debts: ['debt', 'owe', 'receivable', 'payable', 'credit', 'دين', 'ديون', 'ذمم', 'مدين', 'قەرز', 'قەرزار', 'قرز'],
  profit: ['profit', 'margin', 'earn', 'loss', 'ربح', 'أرباح', 'ارباح', 'خسار', 'قازانج', 'زیان'],
  sales: ['sale', 'sell', 'sold', 'revenue', 'مبيع', 'بيع', 'فرۆش', 'فروش'],
  stock: ['stock', 'inventory', 'warehouse', 'reorder', 'مخزون', 'مخزن', 'بضاع', 'كمية', 'کۆگا', 'کاڵا', 'کالا'],
  pending: ['pending', 'approv', 'waiting', 'موافق', 'بانتظار', 'معلق', 'ڕەزامەند', 'رەزامەند', 'چاوەڕێ'],
};

/** The tools a question names, in the order of `ASSISTANT_TOOLS`, at most `max` of them. */
export function toolsFor(question: string, max = 3): AssistantTool[] {
  const q = question.toLowerCase();
  return ASSISTANT_TOOLS.filter((tool) => WORDS[tool].some((w) => q.includes(w))).slice(0, max);
}

export type AssistantPeriod = 'today' | 'week' | 'month';

const PERIOD_WORDS: Record<Exclude<AssistantPeriod, 'month'>, readonly string[]> = {
  today: ['today', 'اليوم', 'ئەمڕۆ', 'ئەمرۆ'],
  week: ['week', 'أسبوع', 'اسبوع', 'حەفتە', 'هەفتە'],
};

/** The period a question asks about; the month so far when it names none. */
export function periodFor(question: string): AssistantPeriod {
  const q = question.toLowerCase();
  if (PERIOD_WORDS.today.some((w) => q.includes(w))) return 'today';
  if (PERIOD_WORDS.week.some((w) => q.includes(w))) return 'week';
  return 'month';
}

/** The first day of a period, ending today (ISO dates). */
export function periodRange(period: AssistantPeriod, today: string, addDays: (iso: string, n: number) => string): { from: string; to: string } {
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') return { from: addDays(today, -6), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** What the assistant may be asked in one month, per company. A guard against a runaway bill, not a price. */
export const ASSISTANT_MONTHLY_LIMIT = 300;
