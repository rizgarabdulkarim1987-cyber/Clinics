import type { ScopedTx } from '@/server/data/tenant-db';
import { D } from '@/server/domain/wholesale/money';
import { createCustomer, createItem, createSupplier, seedCities, setItemPrices } from '@/server/wholesale/catalog';
import { issueStock, receiveStock } from '@/server/wholesale/stock';
import { warehouseOfKind } from '@/server/wholesale/warehouses';

/**
 * Sample data for trying the program out: 20 made-up suppliers, 20 customers and 10 grocery items with prices and stock in the main
 * warehouse. It only adds what is missing (matched by supplier name and item code), never changes or stocks anything that
 * exists, and refuses when there is nothing left to add.
 */

export const DEMO_ITEM_CODES = ['SUGAR-1', 'FLOUR-5', 'TOMATO-400', 'PASTA-500', 'LENTIL-1', 'CHICKPEA-1', 'SALT-750', 'MILK-400', 'TUNA-160', 'DATES-1'];

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
export const CUSTOMERS: { name: string; city: string; phone: string }[] = [
  { name: 'Al-Amin Supermarket', city: 'baghdad', phone: '07701230001' },
  { name: 'Al-Noor Grocery', city: 'baghdad', phone: '07701230002' },
  { name: 'Dijla Mini Market', city: 'baghdad', phone: '07801230003' },
  { name: 'Hawre Food Center', city: 'erbil', phone: '07501230004' },
  { name: 'Shanidar Market', city: 'erbil', phone: '07501230005' },
  { name: 'Ankawa Fresh Store', city: 'erbil', phone: '07501230006' },
  { name: 'Salim Wholesale Shop', city: 'sulaymaniyah', phone: '07701230007' },
  { name: 'Slemani Family Market', city: 'sulaymaniyah', phone: '07701230008' },
  { name: 'Bazyan Grocery', city: 'sulaymaniyah', phone: '07701230009' },
  { name: 'Zakho Border Market', city: 'dihok', phone: '07501230010' },
  { name: 'Duhok Central Store', city: 'dihok', phone: '07501230011' },
  { name: 'Kirkuk Citadel Market', city: 'kirkuk', phone: '07701230012' },
  { name: 'Azadi Supermarket', city: 'kirkuk', phone: '07701230013' },
  { name: 'Nineveh Food House', city: 'mosul', phone: '07701230014' },
  { name: 'Old City Grocers', city: 'mosul', phone: '07701230015' },
  { name: 'Al-Sabah Mini Market', city: 'baghdad', phone: '07801230016' },
  { name: 'Karada Provisions', city: 'baghdad', phone: '07801230017' },
  { name: 'Mansour Family Store', city: 'baghdad', phone: '07801230018' },
  { name: 'Bakhtiari Market', city: 'sulaymaniyah', phone: '07701230019' },
  { name: 'Rawanduz Grocery', city: 'erbil', phone: '07501230020' },
];

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

export async function fillDemoData(tx: ScopedTx, rid: string, user: { id: string }): Promise<{ suppliers: number; items: number; customers: number }> {
  const haveSuppliers = new Set((await tx.whSupplier.findMany({ select: { name: true } })).map((s) => s.name));
  const haveCodes = new Set((await tx.whItem.findMany({ select: { code: true } })).map((i) => i.code));
  await seedCities(tx, rid);
  const haveCustomers = new Set((await tx.whCustomer.findMany({ select: { name: true } })).map((c) => c.name));
  const newCustomers = CUSTOMERS.filter((c) => !haveCustomers.has(c.name));
  const newSuppliers = SUPPLIERS.filter((s) => !haveSuppliers.has(s.name));
  const newItems = ITEMS.filter((i) => !haveCodes.has(i.code));
  if (newSuppliers.length === 0 && newItems.length === 0 && newCustomers.length === 0) throw new DemoNotEmptyError();
  for (const s of newSuppliers) await createSupplier(tx, rid, { name: s.name, country: s.country, isForeign: s.foreign, phone: s.phone });
  const cities = new Map((await tx.whCity.findMany({ select: { id: true, code: true } })).map((c) => [c.code, c.id]));
  for (const c of newCustomers) await createCustomer(tx, rid, { name: c.name, phone: c.phone, cityId: cities.get(c.city) ?? [...cities.values()][0]! });
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
  return { suppliers: newSuppliers.length, items: newItems.length, customers: newCustomers.length };
}

/**
 * Takes the sample data out again. Stock movements are append-only, so an item that received sample stock cannot be erased:
 * its stock is written off (a DEMO_CLEAR movement) and the item is archived, which leaves nothing in the stock value or on
 * any list. A sample customer or supplier with no documents is deleted. Anything that has real documents on it (a sale, a
 * purchase, a payment, a count) is kept, and counted, so real books are never touched.
 */
export async function removeDemoData(tx: ScopedTx, rid: string, user: { id: string }): Promise<{ items: number; customers: number; suppliers: number; kept: number }> {
  let kept = 0;
  const codes = DEMO_ITEM_CODES;
  let items = 0;
  for (const item of await tx.whItem.findMany({ where: { code: { in: codes } }, select: { id: true, active: true } })) {
    const real = (await tx.whStockMovement.count({ where: { itemId: item.id, NOT: { refType: { in: ['DEMO', 'DEMO_CLEAR'] } } } })) + (await tx.whSaleLine.count({ where: { itemId: item.id } })) + (await tx.whPurchaseLine.count({ where: { itemId: item.id } })) + (await tx.whStockCountLine.count({ where: { itemId: item.id } }));
    if (real > 0) {
      kept += 1;
      continue;
    }
    for (const b of await tx.whStockBalance.findMany({ where: { itemId: item.id, qtyBase: { gt: 0 } }, select: { warehouseId: true, qtyBase: true } })) {
      await issueStock(tx, { restaurantId: rid, itemId: item.id, warehouseId: b.warehouseId, qtyBase: new D(b.qtyBase.toString()), ref: { type: 'DEMO_CLEAR', id: item.id }, user });
    }
    if (item.active) {
      await tx.whItem.update({ where: { id: item.id }, data: { active: false } });
      items += 1;
    }
  }
  let customers = 0;
  for (const c of await tx.whCustomer.findMany({ where: { name: { in: CUSTOMERS.map((x) => x.name) } }, select: { id: true } })) {
    const used = (await tx.whSale.count({ where: { customerId: c.id } })) + (await tx.whCustomerPayment.count({ where: { customerId: c.id } })) + (await tx.whOpeningDebt.count({ where: { customerId: c.id } }));
    if (used > 0) {
      kept += 1;
      continue;
    }
    await tx.whCustomer.delete({ where: { id: c.id } });
    customers += 1;
  }
  let suppliers = 0;
  for (const s of await tx.whSupplier.findMany({ where: { name: { in: SUPPLIERS.map((x) => x.name) } }, select: { id: true } })) {
    const used = (await tx.whPurchase.count({ where: { supplierId: s.id } })) + (await tx.whSupplierPayment.count({ where: { supplierId: s.id } })) + (await tx.whOpeningDebt.count({ where: { supplierId: s.id } }));
    if (used > 0) {
      kept += 1;
      continue;
    }
    await tx.whSupplier.delete({ where: { id: s.id } });
    suppliers += 1;
  }
  return { items, customers, suppliers, kept };
}

export const DEMO_SUPPLIER_NAMES = SUPPLIERS.map((s) => s.name);
export const DEMO_CUSTOMER_NAMES = CUSTOMERS.map((c) => c.name);
