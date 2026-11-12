import type { PaperDoc, PaperRow } from '@/server/domain/pos/paper';

/** What a sale receipt needs; plain text and numbers, so it can come straight from the sale query. */
export interface ReceiptSale {
  company: string;
  number: string | number | null;
  date: string;
  customer: string;
  credit: boolean;
  currency: string;
  totalDiscount: string;
  totalFinal: string;
  seller: string | null;
  lines: { name: string; qty: string; unitLabel: string; price: string; total: string }[];
}

export interface ReceiptLabels {
  invoice: string;
  customer: string;
  credit: string;
  cash: string;
  discount: string;
  total: string;
}

const money = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

/** The 80 mm sales receipt as rows the print bridge draws: the item on its own line, quantity x price = total under it. */
export function receiptPaperDoc(sale: ReceiptSale, labels: ReceiptLabels): PaperDoc {
  const rows: PaperRow[] = [
    { kind: 'text', align: 'center', left: sale.company, size: 2, bold: true },
    { kind: 'text', align: 'center', left: `${labels.invoice} #${sale.number ?? ''}`.trim() },
    { kind: 'text', align: 'center', left: sale.date },
    { kind: 'rule' },
    { kind: 'text', align: 'start', left: `${labels.customer}: ${sale.customer}` },
    { kind: 'text', align: 'start', left: sale.credit ? labels.credit : labels.cash },
    { kind: 'rule' },
  ];
  for (const l of sale.lines) {
    rows.push({ kind: 'text', align: 'start', left: l.name, bold: true });
    rows.push({ kind: 'text', align: 'start', left: `${money(l.qty)} ${l.unitLabel} x ${money(l.price)}`, right: money(l.total) });
  }
  rows.push({ kind: 'rule' });
  if (Number(sale.totalDiscount) !== 0) rows.push({ kind: 'text', align: 'start', left: labels.discount, right: `${money(sale.totalDiscount)} ${sale.currency}` });
  rows.push({ kind: 'text', align: 'start', left: labels.total, right: `${money(sale.totalFinal)} ${sale.currency}`, size: 2, bold: true });
  if (sale.seller) rows.push({ kind: 'text', align: 'center', left: sale.seller });
  rows.push({ kind: 'gap' });
  return { rows };
}
