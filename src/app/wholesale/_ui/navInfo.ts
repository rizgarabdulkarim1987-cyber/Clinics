import type { Translate } from '@/lib/i18n';
import type { NavMeta } from './NavLinks';

export interface NavInfo {
  items: number;
  customers: number;
  staff: number;
  salesToday: number;
  expiring: number;
  pending: { sales: number; handovers: number; expenses: number };
}


/** The line under a section's name and the count that waits on the person, from the live numbers. */
export function infoOf(key: string, i: NavInfo | undefined, t: Translate): { sub?: string; badge?: number } {
  if (!i) return {};
  switch (key) {
    case 'home':
      return { sub: t('wh.navinfo.home', { n: i.salesToday }), badge: i.pending.sales + i.pending.handovers + i.pending.expenses + i.expiring || undefined };
    case 'sales':
      return { sub: t('wh.navinfo.sales', { n: i.customers }), badge: i.pending.sales || undefined };
    case 'stock':
      return { sub: t('wh.navinfo.stock', { n: i.items }), badge: i.expiring || undefined };
    case 'money':
      return { sub: t('wh.navinfo.money', { a: i.pending.handovers, b: i.pending.expenses }), badge: i.pending.handovers + i.pending.expenses || undefined };
    case 'admin':
      return i.staff ? { sub: t('wh.navinfo.admin', { n: i.staff }) } : {};
    default:
      return {};
  }
}


/** The side menu's lines and counts for every section, built where the translator lives (the server). */
export function navMeta(keys: string[], i: NavInfo | null | undefined, t: Translate): NavMeta {
  return Object.fromEntries(keys.map((k) => [k, infoOf(k, i ?? undefined, t)]));
}
