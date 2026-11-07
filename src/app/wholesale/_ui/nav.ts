import { Boxes, Coins, Contact, Home, PackageSearch, ShoppingCart, Truck, Users, type LucideIcon } from 'lucide-react';
import { canWh, type WhPermission, type WhRole } from '@/server/domain/wholesale/permissions';

export type WhNavKey = 'home' | 'catalog' | 'stock' | 'customers' | 'suppliers' | 'purchases' | 'rates' | 'staff';

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
  { key: 'rates', href: '/wholesale/rates', labelKey: 'wh.nav.rates', icon: Coins, needs: 'rate.set' },
  { key: 'staff', href: '/wholesale/staff', labelKey: 'wh.nav.staff', icon: Users, needs: 'staff.manage' },
];

/** The places a role is shown: a rep never sees suppliers or people. */
export function whNav(role: WhRole): WhNavItem[] {
  return ALL.filter((item) => canWh(role, item.needs));
}
