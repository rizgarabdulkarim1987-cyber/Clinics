import { describe, expect, it } from 'vitest';
import { clinicLimitsSchema } from '@/server/domain/clinic/limits';
import { APPLICATION_IDS, DEFAULT_APPLICATIONS, planCodesFor } from '@/server/domain/billing/catalog';
import { BUSINESS_SECTORS } from '@/server/domain/restaurant-profile';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/server/domain/audit-actions';

describe('the limits a Clinics plan carries', () => {
  it('accepts no limit at all', () => {
    expect(clinicLimitsSchema.parse({})).toEqual({});
  });

  it('accepts a positive count of doctors and of branches', () => {
    expect(clinicLimitsSchema.parse({ maxDoctors: 3, maxBranches: 2 })).toEqual({ maxDoctors: 3, maxBranches: 2 });
  });

  it('refuses zero, a fraction, a negative number and an unknown limit', () => {
    expect(() => clinicLimitsSchema.parse({ maxDoctors: 0 })).toThrow();
    expect(() => clinicLimitsSchema.parse({ maxDoctors: 1.5 })).toThrow();
    expect(() => clinicLimitsSchema.parse({ maxBranches: -1 })).toThrow();
    expect(() => clinicLimitsSchema.parse({ maxPatients: 10 })).toThrow();
  });
});

describe('Clinics in the shared catalogues', () => {
  it('is a business sector and a billing product with plans of its own (no fixed codes)', () => {
    expect(BUSINESS_SECTORS).toContain('CLINIC');
    expect(APPLICATION_IDS).toContain('clinic');
    expect(planCodesFor('clinic')).toEqual([]);
  });

  it('is seeded disabled, last, with a name in the three languages', () => {
    const clinic = DEFAULT_APPLICATIONS.find((app) => app.id === 'clinic');
    expect(clinic).toMatchObject({ status: 'DISABLED', sortOrder: 6 });
    expect(Object.keys(clinic!.name).sort()).toEqual(['ar', 'ckb', 'en']);
  });

  it('has its own audit names', () => {
    expect(AUDIT_ACTIONS).toContain('clinic.settings_changed');
    expect(AUDIT_ENTITY_TYPES).toContain('ClSettings');
  });
});
