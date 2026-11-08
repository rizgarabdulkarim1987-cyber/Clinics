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
  /** Prices other than the list price, approving a rep's held sale, cancelling a sale. */
  'sale.override',
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
  /** Confirming what a rep hands over from his custody. */
  'custody.confirm',
  /** A rep handing his cash to the office and recording his own expenses (fuel). */
  'custody.submit',
  'expense.submit',
] as const;
export type WhPermission = (typeof WH_PERMISSIONS)[number];

const REP: readonly WhPermission[] = ['catalog.view', 'stock.view', 'sale.create', 'sale.return', 'payment.collect', 'custody.submit', 'expense.submit'];

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

/** A person asked for something his role does not allow (a rep selling to another rep's customer or from another warehouse). */
export class ForbiddenError extends Error {
  constructor(readonly permission: string) {
    super(`not allowed: ${permission}`);
    this.name = 'ForbiddenError';
  }
}
