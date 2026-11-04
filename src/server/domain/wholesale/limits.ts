import { z } from 'zod';

/**
 * The limits a Wholesale plan carries: none. Wholesale is one separate copy per company, so a plan sets a price and a
 * name and nothing else; the company's own system is not capped by Core. Strict, so a limit written by mistake is an error.
 */
export const wholesaleLimitsSchema = z.object({}).strict();
export type WholesaleLimits = z.infer<typeof wholesaleLimitsSchema>;
