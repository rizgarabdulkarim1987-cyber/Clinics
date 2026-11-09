/**
 * The agency's simple books (docs/superpowers/specs/2026-11-09-agency-accounts-design.md): slugs for clients and the
 * totals the screen and the Excel file show. Pure functions, so the browser and the server read the money the same way.
 *
 * Money is in each currency's minor unit. Dinars and dollars are always totalled apart; the one exception is the
 * combined line, which adds dollars to dinars at the exchange rate the owner typed (each movement keeps the rate of the day it was typed in).
 */

export type AccountCurrency = 'IQD' | 'USD';
export type AccountKind = 'INCOME' | 'EXPENSE';

export const ACCOUNT_CURRENCIES: readonly AccountCurrency[] = ['IQD', 'USD'];

/** The longest slug a client gets. */
export const SLUG_MAX = 60;

/** One movement of money as the totals read it. `occurredOn` is a calendar day, `YYYY-MM-DD`. */
export interface AccountMovement {
  kind: AccountKind;
  amountMinor: number;
  currency: AccountCurrency;
  clientId: string | null;
  occurredOn: string;
  /** Whole dinars for one dollar on the day it was typed in; null when no rate had been set yet. */
  rate?: number | null;
}

export interface Totals {
  income: number;
  expense: number;
  net: number;
}

export type CurrencyTotals = Record<AccountCurrency, Totals>;

export type Period = { kind: 'month'; year: number; month: number } | { kind: 'year'; year: number } | { kind: 'all' };

/** Arabic, Persian and Sorani letters as Latin ones, the way people write them on a phone. */
const LETTERS: Record<string, string> = {
  ا: 'a', أ: 'a', آ: 'a', إ: 'i', ٱ: 'a', ب: 'b', پ: 'p', ت: 't', ث: 'th', ج: 'j', چ: 'ch', ح: 'h', خ: 'kh', د: 'd', ذ: 'dh',
  ر: 'r', ڕ: 'r', ز: 'z', ژ: 'zh', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ڤ: 'v', ق: 'q',
  ك: 'k', ک: 'k', گ: 'g', ل: 'l', ڵ: 'l', م: 'm', ن: 'n', ه: 'h', ە: 'e', ة: 'a', و: 'w', ۆ: 'o', ؤ: 'o', ي: 'y', ی: 'y',
  ى: 'a', ێ: 'e', ئ: 'e', ء: '', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/** Vowel marks, the dagger alef and the combining hamsa, and the tatweel that stretches a word. */
const MARKS = /[ً-ٰٕـ]/g;

/** A client's slug from its name: `Cafe Zahra!` is `cafe-zahra`. Empty when the name has no letters or digits. */
export function slugFromName(name: string): string {
  let out = '';
  for (const char of name.replace(MARKS, '')) {
    const mapped = LETTERS[char];
    out += mapped !== undefined ? mapped : char.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  const slug = out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, SLUG_MAX).replace(/-+$/g, '');
}

/** The slug as it will be stored: itself when free, else with `-2`, `-3` and so on. An empty slug becomes `client`. */
export function nextSlug(slug: string, taken: ReadonlySet<string>): string {
  const base = slug || 'client';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const emptyTotals = (): Totals => ({ income: 0, expense: 0, net: 0 });
const emptyCurrencyTotals = (): CurrencyTotals => ({ IQD: emptyTotals(), USD: emptyTotals() });

function addTo(bucket: Totals, kind: AccountKind, minor: number): void {
  if (kind === 'INCOME') bucket.income += minor;
  else bucket.expense += minor;
  bucket.net = bucket.income - bucket.expense;
}

/**
 * Adds one movement. With no `rate`, to its own currency. With one, to both lines: `IQD` holds the whole of it in dinars
 * and `USD` the whole of it in dollars, each movement at the rate it was typed in with (`movement.rate`), or at `rate`
 * when it was typed in before any rate was set. Each movement is rounded to a whole dinar or a cent.
 */
function add(into: CurrencyTotals, movement: AccountMovement, rate: number | null): void {
  if (rate === null) {
    addTo(into[movement.currency], movement.kind, movement.amountMinor);
    return;
  }
  const used = movement.rate ?? rate;
  const isDinar = movement.currency === 'IQD';
  addTo(into.IQD, movement.kind, isDinar ? movement.amountMinor : Math.round((movement.amountMinor * used) / 100));
  addTo(into.USD, movement.kind, isDinar ? Math.round((movement.amountMinor * 100) / used) : movement.amountMinor);
}

/** The movements of a month, a year, or all of them. */
export function inPeriod<T extends { occurredOn: string }>(movements: readonly T[], period: Period): T[] {
  if (period.kind === 'all') return [...movements];
  const prefix = period.kind === 'year' ? `${period.year}-` : `${period.year}-${String(period.month).padStart(2, '0')}-`;
  return movements.filter((movement) => movement.occurredOn.startsWith(prefix));
}

/** Income, expense and net: in each currency apart, or, with a current `rate`, all of it in dinars and all of it in dollars. */
export function summarize(movements: readonly AccountMovement[], rate: number | null = null): CurrencyTotals {
  const totals = emptyCurrencyTotals();
  for (const movement of movements) add(totals, movement, rate);
  return totals;
}

/** The twelve months of a year, January first. */
export function byMonth(movements: readonly AccountMovement[], year: number, rate: number | null = null): CurrencyTotals[] {
  const months = Array.from({ length: 12 }, emptyCurrencyTotals);
  for (const movement of movements) {
    if (!movement.occurredOn.startsWith(`${year}-`)) continue;
    const month = Number(movement.occurredOn.slice(5, 7)) - 1;
    if (month >= 0 && month < 12) add(months[month]!, movement, rate);
  }
  return months;
}

export interface ClientRow {
  clientId: string | null;
  /** The client's name; null for the row of movements that belong to no client. */
  name: string | null;
  totals: CurrencyTotals;
}

/**
 * What each client brought in and cost, best dinar profit first (then dollar profit), and last the movements that belong
 * to no client (gear, subscriptions) when there are any.
 */
export function byClient(movements: readonly AccountMovement[], names: ReadonlyMap<string, string>, rate: number | null = null): ClientRow[] {
  const rows = new Map<string | null, ClientRow>();
  for (const movement of movements) {
    const key = movement.clientId;
    let row = rows.get(key);
    if (!row) {
      row = { clientId: key, name: key === null ? null : (names.get(key) ?? null), totals: emptyCurrencyTotals() };
      rows.set(key, row);
    }
    add(row.totals, movement, rate);
  }
  const all = [...rows.values()];
  const general = all.filter((row) => row.clientId === null);
  const clients = all
    .filter((row) => row.clientId !== null)
    .sort((a, b) => b.totals.IQD.net - a.totals.IQD.net || b.totals.USD.net - a.totals.USD.net || (a.name ?? '').localeCompare(b.name ?? ''));
  return [...clients, ...general];
}

/** A period as a link and a form carry it: `month:2026-11`, `year:2026`, `all`. */
export function periodKey(period: Period): string {
  if (period.kind === 'all') return 'all';
  if (period.kind === 'year') return `year:${period.year}`;
  return `month:${period.year}-${String(period.month).padStart(2, '0')}`;
}

/** The period a key names, or null when it names none. */
export function parsePeriod(text: string | null | undefined): Period | null {
  if (!text) return null;
  if (text === 'all') return { kind: 'all' };
  const year = /^year:(\d{4})$/.exec(text);
  if (year) return { kind: 'year', year: Number(year[1]) };
  const month = /^month:(\d{4})-(\d{2})$/.exec(text);
  if (month) {
    const number = Number(month[2]);
    if (number >= 1 && number <= 12) return { kind: 'month', year: Number(month[1]), month: number };
  }
  return null;
}

/** The settings key of the exchange rate: whole dinars for one dollar. */
export const RATE_SETTING_KEY = 'agency.usdToIqd';
export const RATE_MAX = 100_000;

/** Whole dinars per dollar, as typed: `1500`, `1,520` or Arabic digits. A rate has no fractions and is above zero. */
export function parseRate(text: string): { ok: true; rate: number } | { ok: false } {
  const digits = text
    .trim()
    .replace(/,/g, '')
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 0x6f0));
  if (!/^\d{1,7}$/.test(digits)) return { ok: false };
  const rate = Number(digits);
  return rate >= 1 && rate <= RATE_MAX ? { ok: true, rate } : { ok: false };
}
