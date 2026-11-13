import { describe, expect, it } from 'vitest';
import { itemsNamed } from '@/server/domain/wholesale/assistant';

const items = [
  { id: 'almond', names: { ar: 'لوز كازاخستاني', ckb: '', en: '' } },
  { id: 'rice-kz', names: { ar: 'رز كازاخستاني', ckb: '', en: '' } },
  { id: 'rice-ir', names: { ar: 'رز إيراني، منّ السما', ckb: '', en: '' } },
];

describe('itemsNamed', () => {
  it('finds the item a "how many" question names, ignoring the filler and the leading ال', () => {
    expect(itemsNamed('كم فردة موجودة لوز الكازاخستاني ؟', items)).toEqual(['almond']);
  });
  it('returns every item a short word fits, and none for a question that names no item', () => {
    expect(itemsNamed('الرز', items).sort()).toEqual(['rice-ir', 'rice-kz']);
    expect(itemsNamed('كم الربح هذا الشهر؟', items)).toEqual([]);
    expect(itemsNamed('كم النقد عندنا؟', items)).toEqual([]);
  });
});
