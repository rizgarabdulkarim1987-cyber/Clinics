import { describe, expect, it } from 'vitest';
import { getStudioTranslator } from '@/studio/messages';
import clinicAr from '@/studio/messages/clinic/ar';
import clinicCkb from '@/studio/messages/clinic/ckb';
import clinicEn from '@/studio/messages/clinic/en';
import { CLINIC_WORDS, clinicTwin, RETAIL_WORDS, spaceActions, spaceT } from '@/studio/space-words';

/** The Clinics space says its own words: no restaurant, menu, till, shop or pharmacy shows on a clinic's screens. */

const LOCALES = ['en', 'ar', 'ckb'] as const;
const FILES = { en: clinicEn, ar: clinicAr, ckb: clinicCkb } as const;

describe('Clinics words', () => {
  it('has a twin of every shared text it swaps, in every language', () => {
    expect(CLINIC_WORDS).toBe(RETAIL_WORDS);
    for (const locale of LOCALES) {
      const t = getStudioTranslator(locale);
      for (const key of CLINIC_WORDS) expect(t(clinicTwin(key)), `${locale} ${clinicTwin(key)}`).not.toBe(clinicTwin(key));
    }
  });

  it('keeps the same keys in the three language files', () => {
    const keys = (locale: (typeof LOCALES)[number]) => Object.keys(FILES[locale]).sort();
    expect(keys('ar')).toEqual(keys('en'));
    expect(keys('ckb')).toEqual(keys('en'));
  });

  it('reads a shared text as its Clinics twin there, and leaves every other space its own words', () => {
    const t = getStudioTranslator('en');
    const key = 'restaurants.form.create';
    expect(spaceT(t, 'clinic')(key)).toBe(t(clinicTwin(key)));
    expect(spaceT(t, 'clinic')(key)).toBe('Create clinic');
    expect(spaceT(t, 'clinic')('nav.billing')).toBe(t('nav.billing'));
    for (const space of ['food', 'pharmacy', 'wholesale', 'supermarket'] as const) expect(spaceT(t, space)(key)).not.toBe('Create clinic');
    // A translator already in the Clinics words is kept, not swapped twice.
    const once = spaceT(t, 'clinic');
    expect(spaceT(once, 'clinic')).toBe(once);
  });

  it('names no other product in its own messages', () => {
    const OTHERS = {
      en: /\b(restaurants?|menus?|till|cashier|pharmac\w*|retail|wholesale|shops?|supermarket)\b/i,
      ar: /(مطعم|مطاعم|قائمة الطعام|كاشير|صيدل|التجزئة|الجملة|محل|المحل|المحلات|سوبرماركت)/,
      ckb: /(چێشتخانە|مینیو|کاشێر|دەرمانخانە|تاکە فرۆشی|کۆفرۆشی|دوکان|سوپەرمارکێت)/,
    } as const;
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(FILES[locale])) {
        expect(String(value), `${locale} ${key}`).not.toMatch(OTHERS[locale]);
      }
    }
  });

  it('offers its own actions in the activity filter, and no other space offers them', () => {
    const own = spaceActions('clinic');
    expect(own).toContain('clinic.settings_changed');
    expect(own).toContain('restaurant.created');
    expect(own.some((action) => action.startsWith('retail.') || action.startsWith('wholesale.'))).toBe(false);
    for (const space of ['food', 'pharmacy', 'wholesale', 'supermarket'] as const) {
      expect(spaceActions(space).some((action) => action.startsWith('clinic.')), space).toBe(false);
    }
  });
});
