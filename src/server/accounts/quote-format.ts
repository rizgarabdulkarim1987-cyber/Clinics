/** A quote's own number series, `QUO-0001`: never mixed with invoice numbers. Plain functions, safe in the browser. */
export const quoteNumber = (n: number) => `QUO-${String(n).padStart(4, '0')}`;

/** What a quote is called now: still open, answered, or open past its date. */
export function quoteState(quote: { status: 'OPEN' | 'ACCEPTED' | 'DECLINED'; validUntil: string }, today: string): 'open' | 'accepted' | 'declined' | 'expired' {
  if (quote.status === 'ACCEPTED') return 'accepted';
  if (quote.status === 'DECLINED') return 'declined';
  return quote.validUntil < today ? 'expired' : 'open';
}
