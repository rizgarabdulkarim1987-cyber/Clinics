/**
 * Development only: fills the local demo wholesale company ("Nare Trading (Demo)") with 20 suppliers and 10 more grocery items
 * (with prices and stock in the main warehouse), so the screens look like a working business. Safe to run again: whatever
 * already exists (by supplier name or item code) is skipped. Refuses any database that is not on 127.0.0.1.
 * Run: DATABASE_URL=postgresql://...127.0.0.1:<port>/buzzify npx tsx scripts/dev-wholesale-fill.ts
 */
import { getPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { D } from '@/server/domain/wholesale/money';
import { createItem, createSupplier, setItemPrices } from '@/server/wholesale/catalog';
import { receiveStock } from '@/server/wholesale/stock';
import { warehouseOfKind } from '@/server/wholesale/warehouses';

const url = process.env.DATABASE_URL ?? '';
if (!/@127\.0\.0\.1:\d+\//.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at 127.0.0.1');

const prisma = getPrisma();

// Made-up trading companies (no real businesses), local ones in Iraq and foreign ones across the region.
const SUPPLIERS: { name: string; country: string; foreign: boolean; phone: string }[] = [
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
const ITEMS: { code: string; ar: string; ckb: string; en: string; category: string; cost: number; price: number; carton: number; stock: number }[] = [
  { code: 'SUGAR-1', ar: 'سكر 1 كغم', ckb: 'شەکر ١ کیلۆ', en: 'Sugar 1 kg', category: 'Basics', cost: 900, price: 1250, carton: 20, stock: 60 },
  { code: 'FLOUR-5', ar: 'طحين 5 كغم', ckb: 'ئارد ٥ کیلۆ', en: 'Flour 5 kg', category: 'Grains', cost: 4300, price: 5600, carton: 4, stock: 80 },
  { code: 'TOMATO-400', ar: 'معجون طماطم 400 غم', ckb: 'ڕەبی تەماتە ٤٠٠ گرام', en: 'Tomato paste 400 g', category: 'Canned', cost: 850, price: 1200, carton: 24, stock: 50 },
  { code: 'PASTA-500', ar: 'مكرونة 500 غم', ckb: 'ماکارۆنی ٥٠٠ گرام', en: 'Pasta 500 g', category: 'Grains', cost: 700, price: 1000, carton: 20, stock: 70 },
  { code: 'LENTIL-1', ar: 'عدس 1 كغم', ckb: 'نەسک ١ کیلۆ', en: 'Lentils 1 kg', category: 'Legumes', cost: 2100, price: 2800, carton: 12, stock: 40 },
  { code: 'CHICKPEA-1', ar: 'حمص 1 كغم', ckb: 'نۆک ١ کیلۆ', en: 'Chickpeas 1 kg', category: 'Legumes', cost: 2400, price: 3200, carton: 12, stock: 40 },
  { code: 'SALT-750', ar: 'ملح 750 غم', ckb: 'خوێ ٧٥٠ گرام', en: 'Salt 750 g', category: 'Basics', cost: 250, price: 450, carton: 24, stock: 30 },
  { code: 'MILK-400', ar: 'حليب بودرة 400 غم', ckb: 'شیری ئاردکراو ٤٠٠ گرام', en: 'Milk powder 400 g', category: 'Dairy', cost: 3900, price: 5000, carton: 12, stock: 35 },
  { code: 'TUNA-160', ar: 'تونة 160 غم', ckb: 'تۆنا ١٦٠ گرام', en: 'Canned tuna 160 g', category: 'Canned', cost: 1300, price: 1800, carton: 48, stock: 25 },
  { code: 'DATES-1', ar: 'تمر 1 كغم', ckb: 'خورما ١ کیلۆ', en: 'Dates 1 kg', category: 'Dried fruit', cost: 3300, price: 4500, carton: 10, stock: 45 },
];

async function main() {
  const company = await prisma.restaurant.findFirst({ where: { name: 'Nare Trading (Demo)' } });
  if (!company) throw new Error('Run scripts/dev-wholesale.ts first: there is no demo company yet');
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@buzzify.test' } });
  const rid = company.id;
  await scopedClient(prisma, { restaurantId: rid }).$transaction(async (tx) => {
    const have = new Set((await tx.whSupplier.findMany({ select: { name: true } })).map((s) => s.name));
    let suppliers = 0;
    for (const s of SUPPLIERS) {
      if (have.has(s.name)) continue;
      await createSupplier(tx, rid, { name: s.name, country: s.country, isForeign: s.foreign, phone: s.phone });
      suppliers += 1;
    }
    const main = await warehouseOfKind(tx, rid, 'MAIN');
    const codes = new Set((await tx.whItem.findMany({ select: { code: true } })).map((i) => i.code));
    let items = 0;
    for (const it of ITEMS) {
      if (codes.has(it.code)) continue;
      const made = await createItem(tx, rid, {
        code: it.code,
        names: { ar: it.ar, ckb: it.ckb, en: it.en },
        category: it.category,
        baseUnit: 'PIECE',
        units: [
          { unit: 'PIECE', factorToBase: '1' },
          { unit: 'CARTON', factorToBase: String(it.carton) },
        ],
      });
      await setItemPrices(tx, rid, made.id, [
        { unit: 'PIECE', priceIqd: String(it.price) },
        { unit: 'CARTON', priceIqd: String(it.price * it.carton) },
      ]);
      await receiveStock(tx, { restaurantId: rid, itemId: made.id, warehouseId: main.id, qtyBase: new D(it.carton * it.stock), unitCostIqd: new D(it.cost), ref: { type: 'DEV', id: it.code }, user: { id: owner.id } });
      items += 1;
    }
    console.log(`Added ${suppliers} suppliers and ${items} items to ${company.name}`);
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
