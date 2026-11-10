/**
 * A rep's monthly targets and how far the month's sales have gone toward them. Pure maths, no database: the query feeds it the
 * rep's posted sales of the month.
 */

export type SaleFact = { amountIqd: number; lines: { itemId: string; baseUnit: string; qtyBase: number }[] };
export type Achieved = { amountIqd: number; weightKg: number; pieces: number; items: Record<string, number> };

/** Kilograms in one base unit of a weighed item; items counted in pieces or cartons carry no weight. */
const KG_PER_BASE: Record<string, number> = { KG: 1, TON: 1000 };

export function achievedOf(facts: SaleFact[]): Achieved {
  const done: Achieved = { amountIqd: 0, weightKg: 0, pieces: 0, items: {} };
  for (const f of facts) {
    done.amountIqd += f.amountIqd;
    for (const l of f.lines) {
      done.items[l.itemId] = (done.items[l.itemId] ?? 0) + l.qtyBase;
      const kg = KG_PER_BASE[l.baseUnit];
      if (kg !== undefined) done.weightKg += l.qtyBase * kg;
      else if (l.baseUnit === 'PIECE') done.pieces += l.qtyBase;
    }
  }
  return done;
}

/** How far along, in whole percent (can pass 100); null when there is no target of that kind. */
export function percentOf(done: number, goal: number | null | undefined): number | null {
  if (goal === null || goal === undefined || !(goal > 0)) return null;
  return Math.round((done / goal) * 100);
}

export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** First and last day of a 'YYYY-MM' month. */
export function monthRange(month: string): { from: string; to: string } {
  if (!isMonth(month)) throw new Error(`not a month: ${month}`);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Where the month stands: the share of its days already gone, so a rep at 40% on day 10 of 30 reads as ahead of pace. */
export function monthProgress(today: string, month: string): number {
  const { from, to } = monthRange(month);
  if (today < from) return 0;
  if (today > to) return 100;
  const day = Number(today.slice(8, 10));
  const days = Number(to.slice(8, 10));
  return Math.round((day / days) * 100);
}
