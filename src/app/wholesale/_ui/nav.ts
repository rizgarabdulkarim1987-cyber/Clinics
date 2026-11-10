import { Boxes, Coins, Contact, Home, PackageSearch, Receipt, ShoppingCart, Wallet, HandCoins, Settings, BarChart3, Sparkles, Truck, Users, type LucideIcon } from 'lucide-react';
import { canWh, type WhPermission, type WhRole } from '@/server/domain/wholesale/permissions';

export type WhNavKey = 'home' | 'catalog' | 'stock' | 'customers' | 'suppliers' | 'purchases' | 'sales' | 'treasury' | 'expenses' | 'rates' | 'settings' | 'reports' | 'assistant' | 'staff' | 'opening';

export interface WhNavItem {
  key: WhNavKey;
  href: string;
  labelKey: string;
  icon: LucideIcon;
  /** What the role must hold to see the place. */
  needs: WhPermission;
}

const ALL: WhNavItem[] = [
  { key: 'home', href: '/wholesale/home', labelKey: 'wh.nav.home', icon: Home, needs: 'catalog.view' },
  { key: 'catalog', href: '/wholesale/catalog', labelKey: 'wh.nav.catalog', icon: PackageSearch, needs: 'catalog.view' },
  { key: 'stock', href: '/wholesale/stock', labelKey: 'wh.nav.stock', icon: Boxes, needs: 'stock.view' },
  { key: 'customers', href: '/wholesale/customers', labelKey: 'wh.nav.customers', icon: Contact, needs: 'catalog.view' },
  { key: 'suppliers', href: '/wholesale/suppliers', labelKey: 'wh.nav.suppliers', icon: Truck, needs: 'catalog.manage' },
  { key: 'purchases', href: '/wholesale/purchases', labelKey: 'wh.nav.purchases', icon: ShoppingCart, needs: 'purchase.manage' },
  { key: 'sales', href: '/wholesale/sales', labelKey: 'wh.nav.sales', icon: Receipt, needs: 'sale.create' },
  { key: 'treasury', href: '/wholesale/treasury', labelKey: 'wh.nav.treasury', icon: Wallet, needs: 'custody.submit' },
  { key: 'reports', href: '/wholesale/reports', labelKey: 'wh.nav.reports', icon: BarChart3, needs: 'report.view' },
  { key: 'assistant', href: '/wholesale/assistant', labelKey: 'wh.nav.assistant', icon: Sparkles, needs: 'ai.use' },
  { key: 'expenses', href: '/wholesale/expenses', labelKey: 'wh.nav.expenses', icon: HandCoins, needs: 'expense.submit' },
  { key: 'rates', href: '/wholesale/rates', labelKey: 'wh.nav.rates', icon: Coins, needs: 'rate.set' },
  { key: 'staff', href: '/wholesale/staff', labelKey: 'wh.nav.staff', icon: Users, needs: 'staff.manage' },
  { key: 'opening', href: '/wholesale/opening', labelKey: 'wh.nav.opening', icon: PackageSearch, needs: 'import.apply' },
  { key: 'settings', href: '/wholesale/settings', labelKey: 'wh.nav.settings', icon: Settings, needs: 'settings.manage' },
];

/** The places a role is shown: a rep never sees suppliers or people. */
export function whNav(role: WhRole): WhNavItem[] {
  return ALL.filter((item) => canWh(role, item.needs));
}

/** What a section is called, where it leads, which paths belong to it, and the few places inside it. */
export interface WhGroup {
  key: 'home' | 'sales' | 'stock' | 'money' | 'admin';
  href: string;
  labelKey: string;
  match: string[];
  places: { key: WhNavKey; href: string; labelKey: string }[];
}

/** A section's own screen when it has several parts: they sit side by side on it instead of in tabs. */
const HUBS: Partial<Record<WhGroup['key'], string>> = { money: '/wholesale/money', stock: '/wholesale/inventory', admin: '/wholesale/admin' };


const GROUPS: { key: WhGroup['key']; labelKey: string; keys: WhNavKey[] }[] = [
  { key: 'home', labelKey: 'wh.nav.g.home', keys: ['home', 'reports', 'assistant'] },
  { key: 'sales', labelKey: 'wh.nav.g.sales', keys: ['sales', 'customers'] },
  { key: 'stock', labelKey: 'wh.nav.g.stock', keys: ['stock', 'catalog', 'purchases', 'suppliers'] },
  { key: 'money', labelKey: 'wh.nav.g.money', keys: ['treasury', 'expenses', 'rates'] },
  { key: 'admin', labelKey: 'wh.nav.g.admin', keys: ['settings', 'staff', 'opening'] },
];

/** Five sections at most (a rep sees four): the old fourteen places are the few places inside them. */
export function whGroups(role: WhRole): WhGroup[] {
  const visible = new Map(whNav(role).map((i) => [i.key, i]));
  return GROUPS.flatMap((g) => {
    const places = g.keys.flatMap((k) => {
      const i = visible.get(k);
      return i ? [{ key: i.key, href: i.href, labelKey: i.labelKey }] : [];
    });
    if (places.length === 0) return [];
    const hub = HUBS[g.key];
    const hrefs = places.map((p) => p.href);
    return [{ key: g.key, href: hub && places.length > 1 ? hub : places[0]!.href, labelKey: g.labelKey, match: hub ? [hub, ...hrefs] : hrefs, places }];
  });
}
