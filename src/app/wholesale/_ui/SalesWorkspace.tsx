'use client';

import { Minus, Plus, Search, UserRound, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { postSale } from '@/app/wholesale/_actions/company';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, cx } from '@/studio/ui';

/**
 * The whole sale on one screen: pick the customer, tap items to build the invoice (unit, quantity, list price / discount / typed
 * price per line), choose currency and cash or credit, and post. The customer's account, collecting a payment, the recent sales and
 * returns live in the side panel (`children`), rendered by the page for the chosen customer, so nothing sends the seller to
 * another screen. The cart survives choosing another customer or posting a payment (the page stays mounted).
 */

export type SaleItem = { id: string; label: string; code: string; baseUnit: string; units: { unit: string; barcode: string | null }[]; prices: Record<string, string> };
export type SaleCustomer = { id: string; name: string; phone: string | null };
type Line = { key: string; itemId: string; unit: string; qty: string; mode: 'OFFICIAL' | 'PERCENT' | 'MANUAL'; value: string };

const CURRENCIES = ['IQD', 'USD', 'IRT'] as const;
const UNIT_ORDER = ['CARTON', 'PIECE', 'TON'];
const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

function unitsOf(item: SaleItem): string[] {
  const all = [...new Set([item.baseUnit, ...item.units.map((u) => u.unit)])];
  return all.sort((a, b) => UNIT_ORDER.indexOf(a) - UNIT_ORDER.indexOf(b));
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx('min-h-9 rounded px-3 text-base font-medium transition-colors', o.value === value ? 'bg-ink text-on-ink' : 'text-text hover:bg-hover')}
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
  children,
}: {
  customers: SaleCustomer[];
  items: SaleItem[];
  warehouses: { id: string; label: string }[];
  customerId: string | null;
  isRep: boolean;
  today: string;
  children: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customer, setCustomer] = useState<string | null>(customerId);
  const [changing, setChanging] = useState(customerId === null);
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

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const hit = (i: SaleItem) => !q || i.label.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || i.units.some((u) => u.barcode === q);
    return items.filter(hit).slice(0, 60);
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

  const field = 'min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base';

  return (
    <div className="grid items-start gap-4 px-3 pb-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
      <section aria-label={t('wh.sw.invoice')} className="flex min-w-0 flex-col gap-4">
        {/* customer */}
        <div className="rounded-md border border-line bg-raised p-3">
          {current && !changing ? (
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-hover">
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
              <Button type="button" variant="secondary" onClick={() => setChanging(true)}>
                {t('wh.sw.change')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="relative block">
                <span className="sr-only">{t('wh.sw.searchCustomer')}</span>
                <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)} placeholder={t('wh.sw.pickCustomer')} className={cx(field, 'ps-9')} dir="auto" autoFocus={!current} />
              </label>
              {customers.length === 0 ? (
                <p className="text-base text-muted">{t('wh.sw.noCustomers')}</p>
              ) : (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => pickCustomer(c.id)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-start text-base hover:bg-hover">
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
              {current && (
                <button type="button" onClick={() => setChanging(false)} className="self-start text-sm text-muted underline">
                  {t('wh.sw.close')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* items */}
        <div className="flex flex-col gap-2 rounded-md border border-line bg-raised p-3">
          <label className="relative block">
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
            <p className="py-3 text-center text-base text-muted">{t('wh.sw.noItems')}</p>
          ) : (
            <ul className="grid max-h-[34vh] grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
              {shown.map((i) => {
                const u = unitsOf(i)[0] ?? i.baseUnit;
                const p = Number(i.prices[u] ?? NaN);
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => addItem(i)}
                      className="flex min-h-14 w-full flex-col items-start justify-center gap-0.5 rounded-md border border-line px-3 py-1.5 text-start transition-colors hover:border-ink hover:bg-hover active:bg-pressed"
                    >
                      <span className="line-clamp-2 text-base font-medium leading-snug" dir="auto">
                        {i.label}
                      </span>
                      <span className="text-sm text-muted tabular-nums" dir="ltr">
                        {Number.isFinite(p) ? `${money(p)} / ${t(`wh.unit.${u}`)}` : i.code}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* the invoice */}
        <div className="rounded-md border border-line bg-raised">
          <h2 className="border-b border-line px-3 py-2 text-md font-semibold">
            {t('wh.sw.invoice')} {lines.length > 0 && <span className="text-muted tabular-nums">({lines.length})</span>}
          </h2>
          {lines.length === 0 ? (
            <p className="px-3 py-8 text-center text-base text-muted">{t('wh.sw.cartEmpty')}</p>
          ) : (
            <ul>
              {lines.map((l) => {
                const item = itemById.get(l.itemId)!;
                const price = priceOf(l);
                const open = editing === l.key;
                return (
                  <li key={l.key} className="flex flex-col gap-2 border-b border-line px-3 py-3 last:border-0">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-base font-medium leading-snug" dir="auto">
                        {item.label}
                      </p>
                      <button type="button" aria-label={t('wh.sw.remove')} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-text">
                        <X aria-hidden className="size-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <div role="radiogroup" aria-label={t('wh.purchases.unit')} className="inline-flex rounded-md border border-line-strong p-0.5">
                        {unitsOf(item).map((u) => (
                          <button key={u} type="button" role="radio" aria-checked={u === l.unit} onClick={() => patch(l.key, { unit: u })} className={cx('min-h-9 rounded px-2.5 text-base', u === l.unit ? 'bg-ink text-on-ink' : 'hover:bg-hover')}>
                            {t(`wh.unit.${u}`)}
                          </button>
                        ))}
                      </div>
                      <div className="inline-flex items-center rounded-md border border-line-strong">
                        <button type="button" aria-label="-" onClick={() => patch(l.key, { qty: String(Math.max(num(l.qty) - 1, 0)) })} className="grid size-9 place-items-center hover:bg-hover">
                          <Minus aria-hidden className="size-4" />
                        </button>
                        <input aria-label={t('wh.sw.qty')} value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} inputMode="decimal" dir="ltr" className="h-9 w-16 bg-transparent text-center text-base font-semibold tabular-nums" />
                        <button type="button" aria-label="+" onClick={() => patch(l.key, { qty: String(num(l.qty) + 1) })} className="grid size-9 place-items-center hover:bg-hover">
                          <Plus aria-hidden className="size-4" />
                        </button>
                      </div>
                      <button type="button" onClick={() => setEditing(open ? null : l.key)} aria-expanded={open} className="min-h-9 rounded-md px-2 text-base underline decoration-dotted underline-offset-4 hover:bg-hover" dir="ltr">
                        {price === null ? '—' : money(price)}
                        {l.mode === 'PERCENT' && l.value ? ` (−${l.value}%)` : ''}
                      </button>
                      <span className="ms-auto text-md font-semibold tabular-nums" dir="ltr">
                        {price === null ? '' : money(price * num(l.qty))}
                      </span>
                    </div>
                    {open && (
                      <div className="flex flex-wrap items-center gap-2 rounded-md bg-hover p-2">
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

        {/* payment and post: always in reach */}
        <div className="sticky bottom-0 z-10 -mx-3 flex flex-col gap-3 border-t border-line-strong bg-raised px-3 py-3 shadow-[0_-6px_16px_-10px_rgb(0_0_0/0.25)] md:-mx-6 md:px-6 lg:mx-0 lg:rounded-md lg:border">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Segmented label={t('wh.purchases.currency')} value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            <Segmented
              label={t('wh.sw.payment')}
              value={payment}
              onChange={setPayment}
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
              <span className="block text-xl font-semibold tabular-nums leading-tight" dir="ltr">
                {currency === 'IQD' || estimate === 0 ? money(estimate) : `≈ ${money(estimate)} IQD`}
              </span>
              {currency !== 'IQD' && lines.length > 0 && <span className="block text-xs text-muted">{t('wh.sw.estimateNote')}</span>}
            </p>
            <Button type="button" variant="primary" size="lg" className="min-h-12 px-8 text-md" disabled={!valid} pending={pending} onClick={post}>
              {t('wh.sales.post')}
            </Button>
          </div>
        </div>
      </section>

      <aside aria-label={t('wh.sw.account')} className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
        {children}
      </aside>
    </div>
  );
}
