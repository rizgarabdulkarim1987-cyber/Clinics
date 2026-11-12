/**
 * The accounting assistant's rules (Phase 7). Pure: no database, no model.
 *
 * The code decides everything that matters. Which tables answer a question is chosen from the QUESTION's words alone
 * (never from data, never by the model); the tables are computed from the books by the report layer; the model, when
 * there is one, only phrases them and may use no figure the tables do not hold. A question that names nothing gets the
 * list of what the assistant can answer. The assistant has no write tool: nothing it does changes the books.
 */

export const ASSISTANT_TOOLS = ['cash', 'debts', 'profit', 'sales', 'stock', 'pending', 'item'] as const;
export type AssistantTool = (typeof ASSISTANT_TOOLS)[number];

/** Words that name a tool, in English, Arabic and Kurdish (Sorani). Matched as parts of words, case-insensitively. */
const WORDS: Record<AssistantTool, readonly string[]> = {
  cash: ['cash', 'box', 'money', 'treasury', 'صندوق', 'نقد', 'كاش', 'خزين', 'قاسە', 'قاسه', 'پارە', 'پاره', 'کاش'],
  debts: ['debt', 'owe', 'receivable', 'payable', 'credit', 'دين', 'ديون', 'ذمم', 'مدين', 'قەرز', 'قەرزار', 'قرز'],
  profit: ['profit', 'margin', 'earn', 'loss', 'ربح', 'أرباح', 'ارباح', 'خسار', 'قازانج', 'زیان'],
  sales: ['sale', 'sell', 'sold', 'revenue', 'مبيع', 'بيع', 'فرۆش', 'فروش'],
  stock: ['stock', 'inventory', 'warehouse', 'reorder', 'مخزون', 'مخزن', 'بضاع', 'كمية', 'کۆگا', 'کاڵا', 'کالا'],
  pending: ['pending', 'approv', 'waiting', 'موافق', 'بانتظار', 'معلق', 'ڕەزامەند', 'رەزامەند', 'چاوەڕێ'],
  // chosen by naming an item (see itemsNamed), never by a keyword
  item: [],
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

// An item named in the question ------------------------------------------------------------------------------------------------

const FILLER = [
  // Arabic and Iraqi question words, units and the usual filler of "how many X do we have"
  'كم', 'شكد', 'شكو', 'شنو', 'ماذا', 'هل', 'عندنا', 'عندي', 'عندكم', 'لدينا', 'موجود', 'موجوده', 'موجودة', 'يوجد', 'متوفر', 'متوفره', 'متبقي', 'باقي', 'بقي', 'بقى',
  'فرده', 'فردة', 'قطعه', 'قطعة', 'كارتون', 'كرتون', 'طن', 'كيلو', 'كغم', 'كمية', 'كميه', 'رصيد', 'مخزون', 'مخزن', 'صنف', 'مادة', 'ماده', 'سعر', 'من', 'في', 'ما', 'هو', 'هي', 'عن', 'الى', 'على',
  // Kurdish (Sorani)
  'چەند', 'هەیە', 'ماوە', 'لە', 'کۆگا', 'دانە',
  // English
  'how', 'many', 'much', 'is', 'are', 'do', 'we', 'have', 'in', 'stock', 'of', 'the', 'what', 'left', 'item', 'items', 'piece', 'pieces', 'carton', 'ton',
];

/** One spelling for the same word: no marks, one kind of alef/ya/ta marbuta, no leading "ال". */
function plain(word: string): string {
  const w = word
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىیي]/g, 'ي')
    .replace(/[ةە]/g, 'ه')
    .replace(/ک/g, 'ك')
    .replace(/ڤ/g, 'ف')
    .replace(/پ/g, 'ب')
    .replace(/چ/g, 'ج')
    .replace(/گ/g, 'ك');
  return w.length > 3 && w.startsWith('ال') ? w.slice(2) : w;
}
const wordsOf = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter((x) => x !== '').map(plain);
const FILLER_SET = new Set(FILLER.map(plain));

/**
 * The items a question names: every content word of the question (after the filler of "how many do we have") must be part of
 * one of the item's names. Pure: the names are given. At most `max`, the closest first (fewest unmatched words in the name).
 */
export function itemsNamed(question: string, items: readonly { id: string; names: { ckb?: string; ar?: string; en?: string } }[], max = 5): string[] {
  const asked = wordsOf(question).filter((w) => w.length >= 2 && !FILLER_SET.has(w) && !/^\d+$/.test(w));
  if (asked.length === 0) return [];
  const hits: { id: string; extra: number }[] = [];
  for (const item of items) {
    let best: number | null = null;
    for (const name of [item.names.ar, item.names.ckb, item.names.en]) {
      if (!name) continue;
      const parts = wordsOf(name);
      if (asked.every((a) => parts.some((p) => p.includes(a)))) best = Math.min(best ?? Infinity, parts.length - asked.length);
    }
    if (best !== null) hits.push({ id: item.id, extra: best });
  }
  return hits.sort((a, b) => a.extra - b.extra).slice(0, max).map((h) => h.id);
}
