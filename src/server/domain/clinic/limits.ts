import { z } from 'zod';

/**
 * The limits a Clinics plan carries: how many doctors and how many branches a clinic may have. Both are optional (no
 * limit); strict, so a limit written by mistake is an error.
 */
export const clinicLimitsSchema = z
  .object({
    maxDoctors: z.number().int().positive().optional(),
    maxBranches: z.number().int().positive().optional(),
  })
  .strict();
export type ClinicLimits = z.infer<typeof clinicLimitsSchema>;
