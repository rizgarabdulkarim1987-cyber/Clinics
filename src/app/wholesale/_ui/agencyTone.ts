import type { Tone } from './Ui';

/** The colour of an agency order's state: open blue, delivered with a balance amber, closed green, cancelled rose. */
export const STATUS_TONE: Record<string, Tone> = { OPEN: 'blue', DELIVERED: 'amber', CLOSED: 'green', CANCELLED: 'rose' };
