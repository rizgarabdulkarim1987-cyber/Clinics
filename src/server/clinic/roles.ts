import type { ClRole } from './framework';

/**
 * Which screen of the clinic app each role may open, in one table. The menu is built from it (`navFor`) and the server
 * checks it for every page (`canSee`) and, through the roles an action lists, for every action: a person who types a
 * screen's address by hand gets the same refusal as one who has no link to it. A later plan adds its screens here.
 */
export const CL_SCREENS = ['home', 'patients', 'doctors', 'staff'] as const;
export type ClScreen = (typeof CL_SCREENS)[number];

const ALL: readonly ClRole[] = ['OWNER', 'RECEPTION', 'DOCTOR', 'CASHIER'];

const ACCESS: Record<ClScreen, readonly ClRole[]> = {
  home: ALL,
  patients: ['OWNER', 'RECEPTION'],
  doctors: ['OWNER', 'RECEPTION'],
  staff: ['OWNER'],
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
  { screen: 'patients', href: '/clinic/patients', label: 'clinic.app.nav.patients' },
  { screen: 'doctors', href: '/clinic/doctors', label: 'clinic.app.nav.doctors' },
  { screen: 'staff', href: '/clinic/staff', label: 'clinic.app.nav.staff' },
];

export const navFor = (role: ClRole): ClNavItem[] => NAV.filter((item) => canSee(role, item.screen));
