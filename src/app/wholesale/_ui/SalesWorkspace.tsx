'use client';

import { Minus, Plus, Search, UserRound, Wallet, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { postSale } from '@/app/wholesale/_actions/company';
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

export function SalesWorkspace({
  customers,
  items,
  warehouses,
  customerId,
  isRep,
  today,
  debt,
  attention,
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

  const pickCustomer = (id: string) => {
    setCustomer(id);
    setChanging(false);
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
    return customers.filter((x) => !c || x.name.toLowerCase().includes(c) || (x.phone ?? '').includes(c)).slice(0, 8);
  }, [customers, custQuery]);

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
  const valid = Boolean(customer) && lines.length > 0 && lines.every((l) => num(l.qty) > 0 && (l.mode === 'OFFICIAL' || num(l.value) > 0)) && Boolean(warehouseId);

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
      toast.success(result.data.status === 'PENDING_APPROVAL' ? t('wh.sales.held') : t('wh.sales.posted'));
      setLines([]);
      setEditing(null);
      router.refresh();
    });

  const field = 'min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base focus:border-wh-blue';
  const card = 'flex min-h-0 flex-col rounded-lg border border-line bg-raised shadow-[0_1px_2px_rgb(15_42_74/0.06)]';

  return (
    <div className="flex flex-col gap-3 p-3 md:p-4 lg:min-h-0 lg:flex-1">
      {/* customer bar */}
      <div className={cx(card, 'shrink-0 border-s-4 border-s-wh-blue p-2.5')}>
        {current && !changing ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-wh-blue-wash text-wh-blue">
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
            <button type="button" onClick={() => setPanel(true)} className="relative inline-flex min-h-11 items-center gap-2 rounded-md bg-wh-blue-wash px-4 text-base font-semibold text-wh-blue hover:bg-wh-blue hover:text-white">
              <Wallet aria-hidden className="size-4" />
              {t('wh.sw.account')}
              {attention > 0 && <span className="absolute -end-1 -top-1 size-3 rounded-full border-2 border-raised bg-wh-rose" aria-hidden />}
            </button>
            <Button type="button" variant="secondary" onClick={() => setChanging(true)}>
              {t('wh.sw.change')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="relative block flex-1">
                <span className="sr-only">{t('wh.sw.searchCustomer')}</span>
                <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)} placeholder={t('wh.sw.pickCustomer')} className={cx(field, 'ps-9')} dir="auto" autoFocus={!current} />
              </label>
              {current && (
                <Button type="button" variant="secondary" onClick={() => setChanging(false)}>
                  {t('wh.sw.close')}
                </Button>
              )}
              {!current && attention > 0 && (
                <button type="button" onClick={() => setPanel(true)} className="min-h-11 rounded-md bg-wh-rose-wash px-4 text-base font-semibold text-wh-rose">
                  {attention}
                </button>
              )}
            </div>
            {customers.length === 0 ? (
              <p className="text-base text-muted">{t('wh.sw.noCustomers')}</p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                {matches.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => pickCustomer(c.id)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md bg-wh-blue-wash/50 px-3 text-start text-base hover:bg-wh-blue-wash">
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
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_27rem]">
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
                      className={cx('relative flex min-h-20 w-full flex-col items-start justify-between gap-1 rounded-md border border-s-4 border-line px-3 py-2 text-start transition-colors active:brightness-95', h.bar, n > 0 ? h.wash : cx('bg-raised', h.hover))}
                    >
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
          <div className="min-h-[9rem] flex-1 overflow-y-auto">
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
                    <li key={l.key} className={cx('flex flex-col gap-2 border-b border-s-4 border-line px-3 py-2.5 last:border-b-0', h.bar)}>
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
    </div>
  );
}
