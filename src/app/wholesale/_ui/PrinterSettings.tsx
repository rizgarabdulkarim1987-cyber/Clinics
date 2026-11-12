'use client';

import { CircleAlert, CircleCheck, Printer, RefreshCw } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { draftOfPrinter, listBridgePrinters, printerOfDraft, type BridgePrinter, type PrinterDraft } from '@/app/pharmacy/_ui/thermal-print';
import { bridgeAlive } from '@/app/pos/_ui/print/print-client';
import type { PaperDoc } from '@/server/domain/pos/paper';
import { useT } from '@/studio/i18n';
import { Button, Field, Input, Select } from '@/studio/ui';
import { printPaper, readPrinter, writePrinter } from './receipt-printer';

const TEST_DOC: PaperDoc = {
  rows: [
    { kind: 'text', align: 'center', left: 'Buzzify Wholesale', size: 2, bold: true },
    { kind: 'text', align: 'center', left: '80 mm' },
    { kind: 'rule' },
    { kind: 'text', align: 'start', left: 'Test', right: '123,456' },
    { kind: 'gap' },
  ],
};

const EMPTY: Parameters<typeof draftOfPrinter>[0] = { transport: 'FILE', address: '\\\\localhost\\', paperWidth: 80, cut: true, drawerPin: null, drawerOnCash: false };

/** This device's receipt printer, with a test page. Printing then needs no dialog: the receipt goes straight to the printer through the print bridge. */
/** Reads this device's saved printer, so it renders only in the browser. */
export function PrinterSettings() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return mounted ? <PrinterForm /> : null;
}

function PrinterForm() {
  const t = useT();
  const saved = useSyncExternalStore(
    (cb) => {
      window.addEventListener('wh-printer', cb);
      return () => window.removeEventListener('wh-printer', cb);
    },
    () => readPrinter() !== null,
    () => false,
  );
  const [draft, setDraft] = useState<PrinterDraft>(() => draftOfPrinter(readPrinter() ?? EMPTY));
  const [bridge, setBridge] = useState<'unknown' | 'up' | 'down'>('unknown');
  const [found, setFound] = useState<BridgePrinter[]>([]);
  const [note, setNote] = useState<'idle' | 'printing' | 'ok' | 'bridge' | 'printer'>('idle');

  const check = () => {
    setBridge('unknown');
    void bridgeAlive().then((up) => {
      setBridge(up ? 'up' : 'down');
      if (up) void listBridgePrinters().then(setFound);
      else setFound([]);
    });
  };
  useEffect(() => {
    void bridgeAlive().then((up) => {
      setBridge(up ? 'up' : 'down');
      if (up) void listBridgePrinters().then(setFound);
    });
  }, []);

  const change = (patch: Partial<PrinterDraft>) => setDraft({ ...draft, ...patch, drawerPin: 'none', drawerOnCash: false });
  const parsed = printerOfDraft(draft);
  const bad = draft.address.trim() !== '' && !parsed.ok;
  const chosen = found.find((p) => p.shared && p.shareName === draft.address);
  const configured = parsed.ok ? parsed.value : undefined;

  const save = () => {
    if (!parsed.ok) return;
    if (writePrinter(parsed.value ?? null)) toast.success(t('wh.printer.saved'));
  };
  const test = async () => {
    if (!configured) return;
    setNote('printing');
    const result = await printPaper(TEST_DOC, configured);
    setNote(result.ok ? 'ok' : result.reason === 'printer' ? 'printer' : 'bridge');
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-raised p-4" data-testid="wh-printer">
      <h2 className="flex items-center gap-2 text-md font-semibold">
        <Printer className="size-5" aria-hidden />
        {t('wh.printer.title')}
      </h2>
      <p className="text-sm text-muted">{t('wh.printer.intro')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {found.length > 0 && (
          <Field label={t('wh.printer.found')} className="sm:col-span-2">
            <Select
              value={chosen?.name ?? ''}
              onChange={(e) => {
                const p = found.find((x) => x.name === e.target.value);
                if (p) change({ transport: 'FILE', address: p.shared ? p.shareName : '' });
              }}
              options={[{ value: '', label: t('wh.printer.pick') }, ...found.map((p) => ({ value: p.name, label: p.shared ? p.name : `${p.name} (${t('wh.printer.notShared')})`, disabled: !p.shared }))]}
            />
          </Field>
        )}
        <Field label={t('wh.printer.connection')}>
          <Select
            value={draft.transport}
            onChange={(e) => change({ transport: e.target.value as PrinterDraft['transport'], address: '' })}
            options={[
              { value: 'FILE', label: t('wh.printer.shared') },
              { value: 'NETWORK', label: t('wh.printer.network') },
            ]}
          />
        </Field>
        <Field label={t('wh.printer.address')} hint={t(draft.transport === 'FILE' ? 'wh.printer.addressShared' : 'wh.printer.addressNetwork')} {...(bad ? { error: t('wh.printer.addressBad') } : {})}>
          <Input dir="ltr" value={draft.address} onChange={(e) => change({ address: e.target.value })} autoComplete="off" placeholder={draft.transport === 'NETWORK' ? '192.168.1.50:9100' : 'XP80'} />
        </Field>
        <Field label={t('wh.printer.paper')}>
          <Select
            value={draft.paperWidth}
            onChange={(e) => change({ paperWidth: e.target.value as PrinterDraft['paperWidth'] })}
            options={[
              { value: '80', label: '80 mm' },
              { value: '58', label: '58 mm' },
            ]}
          />
        </Field>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input type="checkbox" className="size-5" checked={draft.cut} onChange={(e) => change({ cut: e.target.checked })} />
          {t('wh.printer.cut')}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={!parsed.ok}>
          {t('wh.printer.save')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void test()} disabled={!configured || note === 'printing'}>
          {t('wh.printer.test')}
        </Button>
        <Button type="button" variant="secondary" onClick={check}>
          <RefreshCw className="size-4" aria-hidden />
          {t('wh.printer.check')}
        </Button>
        {saved && <span className="text-sm text-muted">{t('wh.printer.active')}</span>}
      </div>
      {bridge !== 'unknown' && (
        <p className={`flex items-center gap-2 text-sm ${bridge === 'up' ? 'text-success' : 'text-danger'}`} role="status">
          {bridge === 'up' ? <CircleCheck className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
          {t(bridge === 'up' ? 'wh.printer.bridgeUp' : 'wh.printer.bridgeDown')}
        </p>
      )}
      {note !== 'idle' && (
        <p className={`text-sm ${note === 'ok' ? 'text-success' : note === 'printing' ? 'text-muted' : 'text-danger'}`} role="status">
          {t(note === 'printing' ? 'wh.printer.printing' : note === 'ok' ? 'wh.printer.printed' : note === 'printer' ? 'wh.printer.failedPrinter' : 'wh.printer.failedBridge')}
        </p>
      )}
    </section>
  );
}
