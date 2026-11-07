/**
 * What each Wholesale role may do, as pure data (mirrors `../pharmacy/permissions.ts`). The roles match the `WhRole` enum in the
 * Prisma schema: the two partners hold everything (OWNER, PARTNER), the rep (REP) only sells and sees his own warehouse.
 * These are separate from the Studio's, the cashier's and the pharmacy's roles and permissions.
 */

export const WH_ROLES = ['OWNER', 'PARTNER', 'REP'] as const;
export type WhRole = (typeof WH_ROLES)[number];

export const WH_PERMISSIONS = [
  'catalog.view',
  'catalog.manage',
  'stock.view',
  'stock.adjust',
  'stock.count',
  'stock.transfer',
  'cost.view',
  'purchase.manage',
  'sale.create',
  'sale.return',
  'payment.collect',
  'treasury.manage',
  'expense.manage',
  'report.view',
  'ai.use',
  'staff.manage',
  'settings.manage',
  /** The daily exchange rates between the three currencies. */
  'rate.set',
  'import.apply',
  'period.close',
] as const;
export type WhPermission = (typeof WH_PERMISSIONS)[number];

const REP: readonly WhPermission[] = ['catalog.view', 'stock.view', 'sale.create', 'sale.return', 'payment.collect'];

const MATRIX: Record<WhRole, readonly WhPermission[]> = {
  OWNER: WH_PERMISSIONS,
  PARTNER: WH_PERMISSIONS,
  REP,
};

export function canWh(role: WhRole, permission: WhPermission): boolean {
  return MATRIX[role].includes(permission);
}

export function whPermissionsOf(role: WhRole): readonly WhPermission[] {
  return MATRIX[role];
}

/** A rep works from his own warehouse only; a partner works across all of them. */
export function isWarehouseBound(role: WhRole): boolean {
  return role === 'REP';
}
