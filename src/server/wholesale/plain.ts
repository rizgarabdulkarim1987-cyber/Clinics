import Decimal from 'decimal.js';

/** What a query may hand to a screen: no decimal, bigint or Date, only text. */
export type Plain<T> = T extends Decimal ? string : T extends bigint ? string : T extends Date ? string : T extends (infer U)[] ? Plain<U>[] : T extends object ? { [K in keyof T]: Plain<T[K]> } : T;

/** Turns money into text (`toFixed`), counters into text and dates into ISO text, deeply. */
export function plain<T>(value: T): Plain<T> {
  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (Decimal.isDecimal(v)) return (v as Decimal).toFixed();
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as Plain<T>;
}
