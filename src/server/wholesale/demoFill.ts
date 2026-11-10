import type { ScopedTx } from '@/server/data/tenant-db';
import { D } from '@/server/domain/wholesale/money';
import { createItem, createSupplier, setItemPrices } from '@/server/wholesale/catalog';
import { receiveStock } from '@/server/wholesale/stock';
import { warehouseOfKind } from '@/server/wholesale/warehouses';

/**
 * Sample data for trying the program out: 20 made-up suppliers and 10 grocery items with prices and stock in the main
 * warehouse. It only adds what is missing (matched by supplier name and item code), never changes or stocks anything that
 * exists, and refuses when there is nothing left to add.
 */

export class DemoNotEmptyError extends Error {
  constructor() {
    super('The sample data is already in this company');
  }
}

// Made-up trading companies (no real businesses), local ones in Iraq and foreign ones across the region.
export const SUPPLIERS: { name: string; country: string; foreign: boolean; phone: string }[] = [
  { name: 'Al-Rafidain Food Trading', country: 'IQ', foreign: false, phone: '07701110001' },
  { name: 'Hawler Grain Mills', country: 'IQ', foreign: false, phone: '07501110002' },
  { name: 'Sulaymaniyah Oils Co.', country: 'IQ', foreign: false, phone: '07701110003' },
  { name: 'Basra Sugar Depot', country: 'IQ', foreign: false, phone: '07801110004' },
  { name: 'Duhok Dairy Supply', country: 'IQ', foreign: false, phone: '07501110005' },
  { name: 'Mosul Pasta Factory', country: 'IQ', foreign: false, phone: '07701110006' },
  { name: 'Karbala Spices House', country: 'IQ', foreign: false, phone: '07801110007' },
  { name: 'Najaf Tea Traders', country: 'IQ', foreign: false, phone: '07701110008' },
  { name: 'Kirkuk Canned Foods', country: 'IQ', foreign: false, phone: '07701110009' },
  { name: 'Erbil Wholesale Center', country: 'IQ', foreign: false, phone: '07501110010' },
  { name: 'Dubai Gulf Provisions', country: 'AE', foreign: true, phone: '+97150110011' },
  { name: 'Jebel Ali Commodities', country: 'AE', foreign: true, phone: '+97150110012' },
  { name: 'Istanbul Food Export', country: 'TR', foreign: true, phone: '+90212110013' },
  { name: 'Mersin Grain Exporters', country: 'TR', foreign: true, phone: '+90324110014' },
  { name: 'Gaziantep Pasta & Flour', country: 'TR', foreign: true, phone: '+90342110015' },
  { name: 'Tehran Dates & Nuts', country: 'IR', foreign: true, phone: '+98219110016' },
  { name: 'Bandar Abbas Trading', country: 'IR', foreign: true, phone: '+98769110017' },
  { name: 'Amman Legumes Co.', country: 'JO', foreign: true, phone: '+96265110018' },
  { name: 'Aqaba Import House', country: 'JO', foreign: true, phone: '+96232110019' },
  { name: 'Beirut Fine Foods', country: 'LB', foreign: true, phone: '+9611110020' },
];

// cost and price are IQD per piece; carton = pieces per carton; stock = cartons to receive.
export const ITEMS: { code: string; ar: string; ckb: string; en: string; category: string; cost: number; price: number; carton: number; stock: number; kg?: true }[] = [
  { code: 'SUGAR-1', ar: 'سكر', ckb: 'شەکر', en: 'Sugar', category: 'Weight goods', cost: 900, price: 1250, carton: 1000, stock: 20, kg: true },
  { code: 'FLOUR-5', ar: 'طحين', ckb: 'ئارد', en: 'Flour', category: 'Weight goods', cost: 860, price: 1120, carton: 1000, stock: 30, kg: true },
  { code: 'TOMATO-400', ar: 'معجون طماطم 400 غم', ckb: 'ڕەبی تەماتە ٤٠٠ گرام', en: 'Tomato paste 400 g', category: 'Canned', cost: 850, price: 1200, carton: 24, stock: 50 },
  { code: 'PASTA-500', ar: 'مكرونة 500 غم', ckb: 'ماکارۆنی ٥٠٠ گرام', en: 'Pasta 500 g', category: 'Grains', cost: 700, price: 1000, carton: 20, stock: 70 },
  { code: 'LENTIL-1', ar: 'عدس', ckb: 'نەسک', en: 'Lentils', category: 'Weight goods', cost: 2100, price: 2800, carton: 1000, stock: 12, kg: true },
  { code: 'CHICKPEA-1', ar: 'حمص', ckb: 'نۆک', en: 'Chickpeas', category: 'Weight goods', cost: 2400, price: 3200, carton: 1000, stock: 10, kg: true },
  { code: 'SALT-750', ar: 'ملح', ckb: 'خوێ', en: 'Salt', category: 'Weight goods', cost: 333, price: 600, carton: 1000, stock: 8, kg: true },
  { code: 'MILK-400', ar: 'حليب بودرة 400 غم', ckb: 'شیری ئاردکراو ٤٠٠ گرام', en: 'Milk powder 400 g', category: 'Dairy', cost: 3900, price: 5000, carton: 12, stock: 35 },
  { code: 'TUNA-160', ar: 'تونة 160 غم', ckb: 'تۆنا ١٦٠ گرام', en: 'Canned tuna 160 g', category: 'Canned', cost: 1300, price: 1800, carton: 48, stock: 25 },
  { code: 'DATES-1', ar: 'تمر', ckb: 'خورما', en: 'Dates', category: 'Weight goods', cost: 3300, price: 4500, carton: 1000, stock: 6, kg: true },
];

export async function fillDemoData(tx: ScopedTx, rid: string, user: { id: string }): Promise<{ suppliers: number; items: number }> {
  const haveSuppliers = new Set((await tx.whSupplier.findMany({ select: { name: true } })).map((s) => s.name));
  const haveCodes = new Set((await tx.whItem.findMany({ select: { code: true } })).map((i) => i.code));
  const newSuppliers = SUPPLIERS.filter((s) => !haveSuppliers.has(s.name));
  const newItems = ITEMS.filter((i) => !haveCodes.has(i.code));
  if (newSuppliers.length === 0 && newItems.length === 0) throw new DemoNotEmptyError();
  for (const s of newSuppliers) await createSupplier(tx, rid, { name: s.name, country: s.country, isForeign: s.foreign, phone: s.phone });
  const main = await warehouseOfKind(tx, rid, 'MAIN');
  for (const it of newItems) {
    const made = await createItem(tx, rid, {
      code: it.code,
      names: { ar: it.ar, ckb: it.ckb, en: it.en },
      category: it.category,
      baseUnit: it.kg ? 'KG' : 'PIECE',
      units: it.kg
        ? [
            { unit: 'KG', factorToBase: '1' },
            { unit: 'TON', factorToBase: '1000' },
          ]
        : [
            { unit: 'PIECE', factorToBase: '1' },
            { unit: 'CARTON', factorToBase: String(it.carton) },
          ],
    });
    await setItemPrices(tx, rid, made.id, it.kg ? [{ unit: 'KG', priceIqd: String(it.price) }, { unit: 'TON', priceIqd: String(it.price * 1000) }] : [{ unit: 'PIECE', priceIqd: String(it.price) }, { unit: 'CARTON', priceIqd: String(it.price * it.carton) }]);
    await receiveStock(tx, { restaurantId: rid, itemId: made.id, warehouseId: main.id, qtyBase: new D(it.carton * it.stock), unitCostIqd: new D(it.cost), ref: { type: 'DEMO', id: it.code }, user });
  }
  return { suppliers: newSuppliers.length, items: newItems.length };
}
