'use client';

import { Banknote, CalendarClock, HandCoins, ChevronDown, Minus, Plus, Receipt, Search, UserRound, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { collectPayment, postSale } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, cx } from '@/studio/ui';

/**
 * The whole sale on ONE screen that never scrolls as a page: the customer bar on top, the items on the start side (they scroll
 * inside their own card), the invoice with the payment and the post button on the other side (its lines scroll inside the card,
 * the total and the button never leave). The customer's account, collecting, recent sales and returns open as a panel over the
 * screen (`children`, rendered by the page), so nothing sends the seller to another page. The cart survives it all.
 */

export type SaleItem = { id: string; label: string; code: string; baseUnit: string; units: { unit: string; barcode: string | null }[]; prices: Record<string, string> };
export type SaleCustomer = { id: string; name: string; phone: string | null };
export type DebtRow = { id: string; name: string; phone: string | null; totals: Record<string, string>; due: string | null; overdue: boolean };
/** The numbers kept in view on the sell screen. */
export type SellInfo = {
  todayCount: number;
  todayTotals: { currency: string; amount: number }[];
  cash: Record<string, string> | null;
  expired: number;
  soon: number;
  next: { name: string; days: number } | null;
};
type Line = { key: string; itemId: string; unit: string; qty: string; mode: 'OFFICIAL' | 'PERCENT' | 'MANUAL'; value: string };

const CURRENCIES = ['IQD', 'USD', 'IRT'] as const;
const UNIT_ORDER = ['PIECE', 'KG', 'TON', 'CARTON'];
const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Each item keeps one colour (from its id), so a shelf of tiles reads at a glance. Full class names, so Tailwind sees them. */
const HUES = [
  { bar: 'border-s-wh-blue', ink: 'text-wh-blue', wash: 'bg-wh-blue-wash', hover: 'hover:bg-wh-blue-wash', chip: 'bg-wh-blue' },
  { bar: 'border-s-wh-green', ink: 'text-wh-green', wash: 'bg-wh-green-wash', hover: 'hover:bg-wh-green-wash', chip: 'bg-wh-green' },
  { bar: 'border-s-wh-amber', ink: 'text-wh-amber', wash: 'bg-wh-amber-wash', hover: 'hover:bg-wh-amber-wash', chip: 'bg-wh-amber' },
  { bar: 'border-s-wh-rose', ink: 'text-wh-rose', wash: 'bg-wh-rose-wash', hover: 'hover:bg-wh-rose-wash', chip: 'bg-wh-rose' },
  { bar: 'border-s-wh-violet', ink: 'text-wh-violet', wash: 'bg-wh-violet-wash', hover: 'hover:bg-wh-violet-wash', chip: 'bg-wh-violet' },
  { bar: 'border-s-wh-teal', ink: 'text-wh-teal', wash: 'bg-wh-teal-wash', hover: 'hover:bg-wh-teal-wash', chip: 'bg-wh-teal' },
] as const;
const hueOf = (id: string) => HUES[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]!;

function unitsOf(item: SaleItem): string[] {
  const all = [...new Set([item.baseUnit, ...item.units.map((u) => u.unit)])];
  return all.sort((a, b) => UNIT_ORDER.indexOf(a) - UNIT_ORDER.indexOf(b));
}

type Tone = 'blue' | 'green' | 'amber';
const ON: Record<Tone, string> = { blue: 'bg-wh-blue text-white', green: 'bg-wh-green text-white', amber: 'bg-wh-amber text-white' };

function Segmented<T extends string>({ value, onChange, options, label, tone = (() => 'blue') as (v: T) => Tone }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; tone?: (v: T) => Tone }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx('min-h-9 rounded px-3 text-base font-semibold transition-colors', o.value === value ? ON[tone(o.value)] : 'text-text hover:bg-hover')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function InfoStrip({ info, t, debtCount, onDebts }: { info: SellInfo; t: (k: string, p?: Record<string, string | number>) => string; debtCount: number; onDebts: () => void }) {
  const cash = info.cash ? (['IQD', 'USD', 'IRT'] as const).filter((c) => Number(info.cash![c] ?? 0) !== 0) : [];
  const stat = 'flex min-w-0 items-center gap-2.5 px-3.5 py-1.5';
  const icon = 'grid size-8 shrink-0 place-items-center rounded-full';
  return (
    <div className="flex shrink-0 flex-wrap divide-x divide-line rounded-lg border border-line bg-raised shadow-[0_1px_2px_rgb(15_42_74/0.06)] rtl:divide-x-reverse xl:flex-nowrap">
      <div className={stat}>
        <span className={cx(icon, 'bg-wh-blue-wash text-wh-blue')}>
          <Receipt aria-hidden className="size-4" />
        </span>
        <p className="min-w-0">
          <span className="block text-xs text-muted">{t('wh.sw.salesToday')}</span>
          <span className="block whitespace-nowrap text-base font-bold tabular-nums" dir="ltr">
            {info.todayTotals.length === 0 ? '0' : info.todayTotals.map((x) => `${money(x.amount)} ${x.currency}`).join(' · ')}
          </span>
          <span className="block text-xs text-muted">{t('wh.sw.invoicesN', { n: info.todayCount })}</span>
        </p>
      </div>
      {info.cash && (
        <div className={stat}>
          <span className={cx(icon, 'bg-wh-green-wash text-wh-green')}>
            <Banknote aria-hidden className="size-4" />
          </span>
          <p className="min-w-0">
            <span className="block text-xs text-muted">{t('wh.sw.cashTill')}</span>
            <span className="block whitespace-nowrap text-base font-bold tabular-nums" dir="ltr">
              {cash.length === 0 ? '0' : cash.map((c) => `${money(Number(info.cash![c]))} ${c}`).join(' · ')}
            </span>
          </p>
        </div>
      )}
      <div className={stat}>
        <span className={cx(icon, info.expired > 0 ? 'bg-wh-rose-wash text-wh-rose' : info.soon > 0 ? 'bg-wh-amber-wash text-wh-amber' : 'bg-wh-teal-wash text-wh-teal')}>
          <CalendarClock aria-hidden className="size-4" />
        </span>
        <p className="min-w-0">
          <span className="block text-xs text-muted">{t('wh.sw.expiry')}</span>
          <span className="block whitespace-nowrap text-base font-bold">
            {info.expired === 0 && info.soon === 0 ? t('wh.sw.expiryNone') : [info.expired > 0 ? t('wh.sw.expiredN', { n: info.expired }) : '', info.soon > 0 ? t('wh.sw.soonN', { n: info.soon }) : ''].filter(Boolean).join(' · ')}
          </span>
          {info.next && (
            <span className="block max-w-56 truncate text-xs text-muted" dir="auto">
              {t('wh.sw.nextExpiry', { name: info.next.name, d: info.next.days })}
            </span>
          )}
        </p>
      </div>
      <button type="button" onClick={onDebts} className={cx(stat, 'text-start hover:bg-hover')}>
        <span className={cx(icon, debtCount > 0 ? 'bg-wh-amber-wash text-wh-amber' : 'bg-wh-teal-wash text-wh-teal')}>
          <HandCoins aria-hidden className="size-4" />
        </span>
        <p className="min-w-0">
          <span className="block text-xs text-muted">{t('wh.sw.debts')}</span>
          <span className="block whitespace-nowrap text-base font-bold">{debtCount > 0 ? t('wh.sw.debtsN', { n: debtCount }) : t('wh.sw.debtsNone')}</span>
        </p>
      </button>
    </div>
  );
}

export function SalesWorkspace({
  customers,
  items,
  warehouses,
  customerId,
  isRep,
  today,
  debt,
  attention,
  info,
  debts,
  children,
}: {
  customers: SaleCustomer[];
  items: SaleItem[];
  warehouses: { id: string; label: string }[];
  customerId: string | null;
  isRep: boolean;
  today: string;
  /** What the chosen customer owes, as text ('' when nothing). */
  debt: string;
  /** Sales waiting for approval (a dot on the account button). */
  attention: number;
  info: SellInfo;
  debts: DebtRow[];
  children: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customer, setCustomer] = useState<string | null>(customerId);
  const [changing, setChanging] = useState(customerId === null);
  const [panel, setPanel] = useState(false);
  const [custQuery, setCustQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [paidNow, setPaidNow] = useState('');
  const [debtsOpen, setDebtsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('IQD');
  const [payment, setPayment] = useState<'CASH' | 'CREDIT'>('CASH');
  const [dueDate, setDueDate] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const seq = useRef(0);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const current = customers.find((c) => c.id === customer) ?? null;

  useEffect(() => {
    if (!listOpen) return;
    const away = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [listOpen]);

  const pickCustomer = (id: string) => {
    setCustomer(id);
    setChanging(false);
    setListOpen(false);
    setCustQuery('');
    router.replace(`?c=${id}`, { scroll: false });
  };

  const addItem = (item: SaleItem, unit?: string) => {
    const u = unit ?? unitsOf(item)[0] ?? item.baseUnit;
    setLines((ls) => {
      const same = ls.find((l) => l.itemId === item.id && l.unit === u && l.mode === 'OFFICIAL');
      if (same) return ls.map((l) => (l === same ? { ...l, qty: String(num(l.qty) + 1) } : l));
      seq.current += 1;
      return [...ls, { key: `l${seq.current}`, itemId: item.id, unit: u, qty: '1', mode: 'OFFICIAL', value: '' }];
    });
  };
  const patch = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const inCart = (id: string) => lines.filter((l) => l.itemId === id).reduce((s, l) => s + num(l.qty), 0);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const hit = (i: SaleItem) => !q || i.label.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || i.units.some((u) => u.barcode === q);
    return items.filter(hit).slice(0, 120);
  }, [items, q]);
  const matches = useMemo(() => {
    if (customers.length === 0) return [];
    const c = custQuery.trim().toLowerCase();
    return customers.filter((x) => !c || x.name.toLowerCase().includes(c) || (x.phone ?? '').includes(c)).slice(0, 50);
  }, [customers, custQuery]);

  const onCustomerKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setListOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = matches[active] ?? matches[0];
      if (c) pickCustomer(c.id);
    } else if (e.key === 'Escape') setListOpen(false);
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = query.trim();
    const scanned = items.find((i) => i.units.some((u) => u.barcode === code));
    if (scanned) addItem(scanned, scanned.units.find((u) => u.barcode === code)?.unit);
    else if (shown[0]) addItem(shown[0]);
    setQuery('');
  };

  const priceOf = (l: Line): number | null => {
    const official = Number(itemById.get(l.itemId)?.prices[l.unit] ?? NaN);
    if (l.mode === 'OFFICIAL') return Number.isFinite(official) ? official : null;
    if (l.mode === 'PERCENT') return Number.isFinite(official) ? official * (1 - Math.min(Math.max(num(l.value), 0), 100) / 100) : null;
    return num(l.value);
  };
  const estimate = lines.reduce((sum, l) => sum + (priceOf(l) ?? 0) * num(l.qty), 0);
  const paid = payment === 'CREDIT' ? num(paidNow) : 0;
  const overPaid = paid > 0 && estimate > 0 && paid >= estimate && currency === 'IQD';
  const valid = !overPaid && Boolean(customer) && lines.length > 0 && lines.every((l) => num(l.qty) > 0 && (l.mode === 'OFFICIAL' || num(l.value) > 0)) && Boolean(warehouseId);

  const post = () =>
    start(async () => {
      const result = await settle(() =>
        postSale({
          customerId: customer ?? '',
          ...(isRep ? {} : { date: today }),
          currency,
          paymentMode: payment,
          warehouseId,
          dueDate: payment === 'CREDIT' && dueDate ? dueDate : null,
          lines: lines.map((l) => ({ itemId: l.itemId, unit: l.unit, qty: l.qty, mode: l.mode, percent: l.mode === 'PERCENT' ? l.value : null, manual: l.mode === 'MANUAL' ? l.value : null })),
        }),
      );
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error).message);
        return;
      }
      const held = result.data.status === 'PENDING_APPROVAL';
      if (payment === 'CREDIT' && paid > 0) {
        if (held) toast.message(t('wh.sw.paidAfterApproval'));
        else {
          const got = await settle(() => collectPayment({ customerId: customer ?? '', saleId: result.data.saleId, amount: String(paid), currency, ...(isRep ? {} : { date: today }) }));
          if (!got.ok) toast.error(`${t('wh.sw.paidFailed')} ${describeFailure(t, locale, got.error).message}`);
        }
      }
      toast.success(held ? t('wh.sales.held') : t('wh.sales.posted'));
      setPaidNow('');
      setLines([]);
      setEditing(null);
      router.refresh();
    });

  const field = 'min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base focus:border-wh-blue';
  const card = 'flex min-h-0 flex-col rounded-lg border border-line bg-raised shadow-[0_1px_2px_rgb(15_42_74/0.06)]';

  return (
    <div className="flex flex-col gap-3 p-3 md:p-4 lg:min-h-0 lg:flex-1">
      <div className="flex shrink-0 flex-col gap-3 xl:flex-row xl:items-stretch">
      {/* customer bar */}
      <div className={cx(card, 'p-1.5 xl:flex-1 xl:justify-center')}>
        {current && !changing ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-wh-blue-wash text-wh-blue">
              <UserRound aria-hidden className="size-5" />
            </span>
            <p className="min-w-0 flex-1">
              <span className="block truncate text-md font-semibold" dir="auto">
                {current.name}
              </span>
              {current.phone && (
                <span className="block text-sm text-muted" dir="ltr">
                  {current.phone}
                </span>
              )}
            </p>
            {debt && (
              <span className="rounded-full bg-wh-amber-wash px-3 py-1 text-base font-semibold text-wh-amber tabular-nums" dir="ltr" title={t('wh.sw.debt')}>
                {debt}
              </span>
            )}
            <button type="button" onClick={() => setPanel(true)} className="relative inline-flex min-h-9 items-center gap-2 rounded-md bg-wh-blue-wash px-3 text-base font-semibold text-wh-blue hover:bg-wh-blue hover:text-white">
              <Wallet aria-hidden className="size-4" />
              {t('wh.sw.account')}
              {attention > 0 && <span className="absolute -end-1 -top-1 size-3 rounded-full border-2 border-raised bg-wh-rose" aria-hidden />}
            </button>
            <Button type="button" variant="secondary" onClick={() => setChanging(true)}>
              {t('wh.sw.change')}
            </Button>
          </div>
        ) : (
          <div ref={pickerRef} className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <span className="sr-only">{t('wh.sw.searchCustomer')}</span>
              <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                role="combobox"
                aria-expanded={listOpen}
                aria-controls="wh-customer-list"
                aria-autocomplete="list"
                value={custQuery}
                onChange={(e) => {
                  setCustQuery(e.target.value);
                  setActive(0);
                  setListOpen(true);
                }}
                onFocus={() => setListOpen(true)}
                onClick={() => setListOpen(true)}
                onKeyDown={onCustomerKey}
                placeholder={t('wh.sw.pickCustomer')}
                className="min-h-9 w-full rounded-md border border-line-strong bg-raised px-3 ps-9 pe-9 text-base focus:border-wh-blue"
                dir="auto"
                autoFocus={!current}
              />
              <ChevronDown aria-hidden className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              {listOpen && (
                <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-line-strong bg-raised shadow-dialog">
                  {customers.length === 0 ? (
                    <p className="px-3 py-3 text-base text-muted">{t('wh.sw.noCustomers')}</p>
                  ) : matches.length === 0 ? (
                    <p className="px-3 py-3 text-base text-muted">{t('wh.sw.noItems')}</p>
                  ) : (
                    <ul id="wh-customer-list" role="listbox" className="max-h-64 overflow-y-auto py-1">
                      {matches.map((c, i) => (
                        <li key={c.id} role="option" aria-selected={i === active}>
                          <button type="button" onClick={() => pickCustomer(c.id)} onMouseEnter={() => setActive(i)} className={cx('flex min-h-10 w-full items-center justify-between gap-3 px-3 text-start text-base', i === active ? 'bg-wh-blue-wash' : 'hover:bg-hover')}>
                            <span className="truncate font-medium" dir="auto">
                              {c.name}
                            </span>
                            {c.phone && (
                              <span className="shrink-0 text-sm text-muted" dir="ltr">
                                {c.phone}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link href="/wholesale/customers" className="flex min-h-10 items-center gap-2 border-t border-line bg-wh-blue-wash/40 px-3 text-base font-semibold text-wh-blue hover:bg-wh-blue-wash">
                    <Plus aria-hidden className="size-4" />
                    {t('wh.sw.newCustomer')}
                  </Link>
                </div>
              )}
            </div>
            {current && (
              <Button type="button" variant="secondary" onClick={() => { setChanging(false); setListOpen(false); }}>
                {t('wh.sw.close')}
              </Button>
            )}
            {!current && attention > 0 && (
              <button type="button" onClick={() => setPanel(true)} className="min-h-11 rounded-md bg-wh-rose-wash px-4 text-base font-semibold text-wh-rose">
                {attention}
              </button>
            )}
          </div>
        )}
      </div>
      <InfoStrip info={info} t={t} debtCount={debts.length} onDebts={() => setDebtsOpen(true)} />
      </div>

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_30rem]">
        {/* items */}
        <section aria-label={t('wh.sw.searchItem')} className={cx(card, 'max-h-[60vh] p-3 lg:max-h-none')}>
          <label className="relative mb-3 block shrink-0">
            <span className="sr-only">{t('wh.sw.searchItem')}</span>
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder={t('wh.sw.searchItem')}
              inputMode="search"
              enterKeyHint="done"
              className={cx(field, 'ps-9')}
              dir="auto"
            />
          </label>
          {shown.length === 0 ? (
            <p className="py-6 text-center text-base text-muted">{t('wh.sw.noItems')}</p>
          ) : (
            <ul className="grid min-h-0 flex-1 content-start grid-cols-2 gap-2 overflow-y-auto pe-1 sm:grid-cols-3 xl:grid-cols-4">
              {shown.map((i) => {
                const u = unitsOf(i)[0] ?? i.baseUnit;
                const p = Number(i.prices[u] ?? NaN);
                const h = hueOf(i.id);
                const n = inCart(i.id);
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => addItem(i)}
                      className={cx('relative flex min-h-20 w-full flex-col items-start justify-between gap-1 rounded-md border border-line px-3 py-2 text-start transition-colors active:brightness-95', n > 0 ? h.wash : cx('bg-raised', h.hover))}
                    >
                      <span aria-hidden className={cx("absolute end-2 top-2 size-2 rounded-full", h.chip)} />
                      <span className="line-clamp-2 text-base font-semibold leading-snug" dir="auto">
                        {i.label}
                      </span>
                      <span className={cx('text-base font-bold tabular-nums', h.ink)} dir="ltr">
                        {Number.isFinite(p) ? money(p) : i.code} <span className="text-xs font-medium text-muted">{Number.isFinite(p) ? `/ ${t(`wh.unit.${u}`)}` : ''}</span>
                      </span>
                      {n > 0 && <span className={cx('absolute end-1.5 top-1.5 grid min-w-6 place-items-center rounded-full px-1.5 text-sm font-bold text-white tabular-nums', h.chip)}>{n}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* the invoice, the payment and the post button */}
        <section aria-label={t('wh.sw.invoice')} className={cx(card, 'overflow-hidden')}>
          <h2 className="flex shrink-0 items-center justify-between bg-wh-rail px-3 py-2.5 text-md font-semibold text-white">
            <span>{t('wh.sw.invoice')}</span>
            {lines.length > 0 && <span className="rounded-full bg-white/15 px-2.5 text-base tabular-nums">{lines.length}</span>}
          </h2>
          <div className="min-h-[14rem] flex-1 overflow-y-auto">
            {lines.length === 0 ? (
              <p className="px-3 py-10 text-center text-base text-muted">{t('wh.sw.cartEmpty')}</p>
            ) : (
              <ul>
                {lines.map((l) => {
                  const item = itemById.get(l.itemId)!;
                  const price = priceOf(l);
                  const open = editing === l.key;
                  const h = hueOf(item.id);
                  return (
                    <li key={l.key} className={cx('flex flex-col gap-2 border-b border-line px-3 py-2.5 last:border-b-0')}>
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 text-base font-semibold leading-snug" dir="auto">
                          {item.label}
                        </p>
                        <span className="text-md font-bold tabular-nums" dir="ltr">
                          {price === null ? '' : money(price * num(l.qty))}
                        </span>
                        <button type="button" aria-label={t('wh.sw.remove')} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="grid size-8 shrink-0 place-items-center rounded-md text-wh-rose hover:bg-wh-rose-wash">
                          <X aria-hidden className="size-4" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <div role="radiogroup" aria-label={t('wh.purchases.unit')} className="inline-flex rounded-md border border-line-strong p-0.5">
                          {unitsOf(item).map((u) => (
                            <button key={u} type="button" role="radio" aria-checked={u === l.unit} onClick={() => patch(l.key, { unit: u })} className={cx('min-h-8 rounded px-2.5 text-sm font-semibold', u === l.unit ? 'bg-wh-blue text-white' : 'hover:bg-hover')}>
                              {t(`wh.unit.${u}`)}
                            </button>
                          ))}
                        </div>
                        <div className="inline-flex items-center rounded-md border border-line-strong">
                          <button type="button" aria-label="-" onClick={() => patch(l.key, { qty: String(Math.max(num(l.qty) - 1, 0)) })} className="grid size-8 place-items-center hover:bg-hover">
                            <Minus aria-hidden className="size-4" />
                          </button>
                          <input aria-label={t('wh.sw.qty')} value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} inputMode="decimal" dir="ltr" className="h-8 w-12 bg-transparent text-center text-base font-bold tabular-nums" />
                          <button type="button" aria-label="+" onClick={() => patch(l.key, { qty: String(num(l.qty) + 1) })} className="grid size-8 place-items-center hover:bg-hover">
                            <Plus aria-hidden className="size-4" />
                          </button>
                        </div>
                        <button type="button" onClick={() => setEditing(open ? null : l.key)} aria-expanded={open} className={cx('min-h-8 rounded-md px-2 text-base underline decoration-dotted underline-offset-4 hover:bg-hover', h.ink)} dir="ltr">
                          × {price === null ? '—' : money(price)}
                          {l.mode === 'PERCENT' && l.value ? ` (−${l.value}%)` : ''}
                        </button>
                      </div>
                      {open && (
                        <div className="flex flex-wrap items-center gap-2 rounded-md bg-wh-blue-wash p-2">
                          <Segmented
                            label={t('wh.sales.priceMode')}
                            value={l.mode}
                            onChange={(mode) => patch(l.key, { mode, value: '' })}
                            options={[
                              { value: 'OFFICIAL', label: t('wh.sw.price.list') },
                              { value: 'PERCENT', label: t('wh.sw.price.percent') },
                              { value: 'MANUAL', label: t('wh.sw.price.manual') },
                            ]}
                          />
                          {l.mode !== 'OFFICIAL' && (
                            <input autoFocus aria-label={l.mode === 'PERCENT' ? t('wh.sales.percentOff') : t('wh.sales.manualPrice')} value={l.value} onChange={(e) => patch(l.key, { value: e.target.value })} inputMode="decimal" dir="ltr" className="min-h-9 w-28 rounded-md border border-line-strong bg-raised px-2 text-base" />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-2.5 border-t-2 border-wh-rail bg-wh-blue-wash/40 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Segmented label={t('wh.purchases.currency')} value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
              <Segmented
                label={t('wh.sw.payment')}
                value={payment}
                onChange={setPayment}
                tone={(v) => (v === 'CREDIT' ? 'amber' : 'green')}
                options={[
                  { value: 'CASH', label: t('wh.purchases.cash') },
                  { value: 'CREDIT', label: t('wh.purchases.credit') },
                ]}
              />
              {payment === 'CREDIT' && <input type="date" aria-label={t('wh.purchases.dueDate')} value={dueDate} onChange={(e) => setDueDate(e.target.value)} dir="ltr" className="min-h-9 rounded-md border border-line-strong bg-raised px-2 text-base" />}
              {payment === 'CREDIT' && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  {t('wh.sw.paidNow')}
                  <input value={paidNow} onChange={(e) => setPaidNow(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0" className={cx('min-h-9 w-28 rounded-md border bg-raised px-2 text-base text-text', overPaid ? 'border-wh-rose' : 'border-line-strong')} />
                </label>
              )}
              {warehouses.length > 1 && (
                <select aria-label={t('wh.sales.warehouse')} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="min-h-9 rounded-md border border-line-strong bg-raised px-2 text-base">
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1">
                <span className="block text-sm text-muted">{t('wh.sw.total')}</span>
                <span className="block text-2xl font-bold leading-tight tabular-nums text-wh-rail" dir="ltr">
                  {currency === 'IQD' || estimate === 0 ? money(estimate) : `≈ ${money(estimate)} IQD`}
                </span>
                {payment === 'CREDIT' && paid > 0 && !overPaid && estimate > 0 && currency === 'IQD' && (
                  <span className="block text-sm font-medium text-wh-amber" dir="auto">
                    {t('wh.sw.rest')}: <span dir="ltr">{money(estimate - paid)}</span>
                  </span>
                )}
                {overPaid && <span className="block text-sm font-medium text-wh-rose">{t('wh.sw.paidTooMuch')}</span>}
                {currency !== 'IQD' && lines.length > 0 && <span className="block text-xs text-muted">{t('wh.sw.estimateNote')}</span>}
              </p>
              <button
                type="button"
                disabled={!valid || pending}
                onClick={post}
                className="min-h-14 min-w-36 rounded-lg bg-wh-green px-8 text-lg font-bold text-white shadow-sm hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted disabled:shadow-none"
              >
                {pending ? '…' : t('wh.sales.post')}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* the customer's account, collecting, recent sales: over the screen, never another page */}
      <div className={cx('fixed inset-0 z-40', !panel && 'hidden')}>
        <button type="button" aria-label={t('wh.sw.close')} className="absolute inset-0 bg-overlay" onClick={() => setPanel(false)} />
        <aside aria-label={t('wh.sw.account')} className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col gap-3 overflow-y-auto bg-wh-canvas p-3 shadow-dialog">
          <div className="flex items-center justify-between">
            <h2 className="text-md font-semibold">{t('wh.sw.account')}</h2>
            <Button type="button" variant="secondary" onClick={() => setPanel(false)}>
              {t('wh.sw.close')}
            </Button>
          </div>
          {children}
        </aside>
      </div>

      <div className={cx('fixed inset-0 z-40', !debtsOpen && 'hidden')}>
        <button type="button" aria-label={t('wh.sw.close')} className="absolute inset-0 bg-overlay" onClick={() => setDebtsOpen(false)} />
        <aside aria-label={t('wh.sw.debts')} className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col gap-3 bg-wh-canvas p-3 shadow-dialog">
          <div className="flex items-center justify-between">
            <h2 className="text-md font-semibold">{t('wh.sw.debts')}</h2>
            <Button type="button" variant="secondary" onClick={() => setDebtsOpen(false)}>
              {t('wh.sw.close')}
            </Button>
          </div>
          {debts.length === 0 ? (
            <p className="py-8 text-center text-base text-muted">{t('wh.sw.debtsNone')}</p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-raised">
              {debts.map((d) => {
                const late = d.due ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d.due}T00:00:00Z`)) / 86_400_000) : 0;
                return (
                  <li key={d.id}>
                    <button type="button" onClick={() => { pickCustomer(d.id); setDebtsOpen(false); setPanel(true); }} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start hover:bg-hover">
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold" dir="auto">
                          {d.name}
                        </span>
                        <span className={cx('mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold', d.overdue ? 'bg-wh-rose-wash text-wh-rose' : d.due ? 'bg-wh-blue-wash text-wh-blue' : 'bg-hover text-muted')}>
                          <CalendarClock aria-hidden className="size-3" />
                          {d.overdue ? t('wh.sw.overdueDays', { n: late }) : d.due ? t('wh.sw.dueOn', { d: d.due }) : t('wh.sw.noDue')}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-base font-bold tabular-nums" dir="ltr">
                        {Object.entries(d.totals).map(([cur, v]) => `${money(Number(v))} ${cur}`).join(' · ')}
                      </span>
                      <span className="rounded-md bg-wh-green px-2.5 py-0.5 text-sm font-semibold text-white">{t('wh.sw.repay')}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
