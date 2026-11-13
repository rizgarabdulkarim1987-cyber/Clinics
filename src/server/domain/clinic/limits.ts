import { z } from 'zod';

/**
 * The limits a Clinics plan carries: how many doctors and how many branches a clinic may have. Both are optional and 0 means
 * no limit (the plan form writes 0 for a limit left blank); strict, so a limit written by mistake is an error.
 */
export const clinicLimitsSchema = z
  .object({
    maxDoctors: z.number().int().min(0).optional(),
    maxBranches: z.number().int().min(0).optional(),
  })
  .strict();
export type ClinicLimits = z.infer<typeof clinicLimitsSchema>;
