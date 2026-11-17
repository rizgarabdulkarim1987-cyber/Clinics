import type { ClRole } from './framework';

/**
 * Which screen of the clinic app each role may open, in one table. The menu is built from it (`navFor`) and the server
 * checks it for every page (`canSee`) and, through the roles an action lists, for every action: a person who types a
 * screen's address by hand gets the same refusal as one who has no link to it. A later plan adds its screens here.
 */
export const CL_SCREENS = ['home', 'board', 'bookings', 'patients', 'doctors', 'services', 'staff', 'cashier', 'reports', 'loyalty', 'packages', 'recall', 'debts'] as const;
export type ClScreen = (typeof CL_SCREENS)[number];

const ALL: readonly ClRole[] = ['OWNER', 'RECEPTION', 'DOCTOR', 'CASHIER'];

const ACCESS: Record<ClScreen, readonly ClRole[]> = {
  home: ALL,
  board: ALL,
  bookings: ['OWNER', 'RECEPTION'],
  patients: ['OWNER', 'RECEPTION'],
  doctors: ['OWNER', 'RECEPTION'],
  services: ['OWNER'],
  staff: ['OWNER'],
  cashier: ['OWNER', 'RECEPTION', 'CASHIER'],
  reports: ['OWNER'],
  loyalty: ['OWNER'],
  packages: ['OWNER', 'RECEPTION'],
  recall: ['OWNER', 'RECEPTION'],
  debts: ['OWNER', 'RECEPTION', 'CASHIER'],
};

export const canSee = (role: ClRole, screen: ClScreen): boolean => ACCESS[screen].includes(role);

export interface ClNavItem {
  screen: ClScreen;
  href: string;
  /** The message key of its label. */
  label: string;
}

const NAV: readonly ClNavItem[] = [
  { screen: 'home', href: '/clinic/home', label: 'clinic.app.nav.home' },
  { screen: 'board', href: '/clinic/board', label: 'clinic.app.nav.board' },
  { screen: 'bookings', href: '/clinic/bookings', label: 'clinic.app.nav.bookings' },
  { screen: 'patients', href: '/clinic/patients', label: 'clinic.app.nav.patients' },
  { screen: 'doctors', href: '/clinic/doctors', label: 'clinic.app.nav.doctors' },
  { screen: 'services', href: '/clinic/services', label: 'clinic.app.nav.services' },
  { screen: 'staff', href: '/clinic/staff', label: 'clinic.app.nav.staff' },
  { screen: 'cashier', href: '/clinic/cashier', label: 'clinic.app.nav.cashier' },
  { screen: 'reports', href: '/clinic/reports', label: 'clinic.app.nav.reports' },
  { screen: 'loyalty', href: '/clinic/loyalty', label: 'clinic.app.nav.loyalty' },
  { screen: 'packages', href: '/clinic/packages', label: 'clinic.app.nav.packages' },
  { screen: 'recall', href: '/clinic/recall', label: 'clinic.app.nav.recall' },
  { screen: 'debts', href: '/clinic/debts', label: 'clinic.app.nav.debts' },
];

export const navFor = (role: ClRole): ClNavItem[] => NAV.filter((item) => canSee(role, item.screen));
