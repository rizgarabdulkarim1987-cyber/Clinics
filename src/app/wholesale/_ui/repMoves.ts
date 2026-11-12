import type { Translate } from '@/lib/i18n';

/** The shapes of a rep's movement as the reps screens receive it. */
export type RepMove = { date: string; number: string; memo: string; sourceType: string; sourceId: string; currency: string; amount: string; side: 'DR' | 'CR' };

const PREFIX: Record<string, RegExp> = { SALE: /^Sale to /, CUSTOMER_PAYMENT: /^Payment from /, EXPENSE: /^Expense( #\d+)?: /, SALE_RETURN: /^Return of sale \d+ from / };

const KINDS = new Set(['SALE', 'CUSTOMER_PAYMENT', 'CUSTODY_HANDOVER', 'CUSTODY_DIRECT', 'EXPENSE', 'SALE_RETURN', 'SALE_CANCEL']);

/**
 * What a movement reads as in the viewer's language: the ledger stores an English memo, so the type is told by the source type and
 * only the name in it (the shop, the expense kind) is kept from the memo.
 */
export function moveLabel(m: Pick<RepMove, 'memo' | 'sourceType'>, t: Translate): string {
  if (!KINDS.has(m.sourceType)) return m.memo;
  const label = t(`wh.reps.kind.${m.sourceType}`);
  const re = PREFIX[m.sourceType];
  const detail = re ? m.memo.replace(re, '') : '';
  return detail && detail !== m.memo ? `${label} · ${detail}` : label;
}
