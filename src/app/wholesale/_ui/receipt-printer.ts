import { kickDrawer, printDoc, type PrintResult } from '@/app/pos/_ui/print/print-client';
import { saleReceiptDoc } from '@/app/wholesale/_actions/company';
import { receiptPrinter, type ReceiptPrinterSettings } from '@/server/domain/pharmacy/print-settings';
import type { PaperDoc } from '@/server/domain/pos/paper';
import type { PrinterView } from '@/server/pos/printers';

/**
 * The receipt printer of this device. The printer is wired to one PC, so the choice lives in the browser, not in the company's data.
 * Set in Settings; the sell screen then prints through it with no dialog. Nothing here throws.
 */

const KEY = 'wh.printer';

export function readPrinter(): ReceiptPrinterSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = receiptPrinter.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.address.trim() !== '' ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A null printer forgets the choice (the sell screen then uses the browser's print window). */
export function writePrinter(printer: ReceiptPrinterSettings | null): boolean {
  try {
    if (printer) localStorage.setItem(KEY, JSON.stringify(printer));
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event('wh-printer'));
    return true;
  } catch {
    return false;
  }
}

export function printerView(p: ReceiptPrinterSettings): PrinterView {
  return { id: 'device', name: 'Receipt', role: 'RECEIPT', transport: p.transport, address: p.address.trim(), paperWidth: p.paperWidth, cut: p.cut, drawerPin: p.drawerPin, isDefault: true, sectionId: null, sortOrder: 0 };
}

export type ReceiptOutcome = PrintResult | { ok: false; reason: 'none'; message: string };

export function printPaper(doc: PaperDoc, p: ReceiptPrinterSettings, drawer = false): Promise<PrintResult> {
  return printDoc(doc, printerView(p), { drawer });
}

/** Opens the cash drawer wired to the printer, with no paper. */
export function openDrawer(p: ReceiptPrinterSettings): Promise<PrintResult> {
  return kickDrawer(printerView(p));
}

/** Fetches the sale's receipt rows and prints them on this device's printer; the drawer opens when the sale took cash and the device is set to. */
export async function printSaleReceipt(saleId: string, p: ReceiptPrinterSettings, cash = false): Promise<ReceiptOutcome> {
  try {
    const doc = await saleReceiptDoc(saleId);
    if (!doc) return { ok: false, reason: 'none', message: 'no receipt for this sale' };
    return await printPaper(doc, p, cash && p.drawerOnCash && p.drawerPin !== null);
  } catch (error) {
    return { ok: false, reason: 'bridge', message: error instanceof Error ? error.message : 'could not print' };
  }
}
