import { describe, expect, it } from 'vitest';
import { receiptPaperDoc, type ReceiptLabels, type ReceiptSale } from '@/server/domain/wholesale/receipt-paper';

const labels: ReceiptLabels = { invoice: 'Invoice', customer: 'Customer', credit: 'Credit', cash: 'Cash', discount: 'Discount', total: 'Total' };
const sale: ReceiptSale = { company: 'Shop', number: 7, date: '2026-11-13', customer: 'Ali', credit: false, currency: 'IQD', totalDiscount: '0', totalFinal: '150000', seller: null, lines: [{ name: 'Sugar', qty: '2', unitLabel: 'carton', price: '75000', total: '150000' }] };

describe('wholesale receipt paper', () => {
  it('puts the item on its own line and quantity x price = total under it', () => {
    const rows = receiptPaperDoc(sale, labels).rows;
    expect(rows).toContainEqual({ kind: 'text', align: 'start', left: 'Sugar', bold: true });
    expect(rows).toContainEqual({ kind: 'text', align: 'start', left: '2 carton x 75,000', right: '150,000' });
  });
  it('shows the discount only when there is one, and the credit mode', () => {
    expect(JSON.stringify(receiptPaperDoc(sale, labels))).not.toContain('Discount');
    const doc = receiptPaperDoc({ ...sale, credit: true, totalDiscount: '5000' }, labels);
    expect(doc.rows).toContainEqual({ kind: 'text', align: 'start', left: 'Discount', right: '5,000 IQD' });
    expect(doc.rows).toContainEqual({ kind: 'text', align: 'start', left: 'Credit' });
  });
});
