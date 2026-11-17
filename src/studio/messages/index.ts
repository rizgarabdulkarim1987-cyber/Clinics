import { createTranslator, type Messages, type Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import ar from './ar';
import ckb from './ckb';
import en from './en';
import beautyAr from './beauty/ar';
import beautyCkb from './beauty/ckb';
import beautyEn from './beauty/en';
import clinicAr from './clinic/ar';
import clinicCkb from './clinic/ckb';
import clinicEn from './clinic/en';
import salesDishesAr from './sales-dishes/ar';
import salesDishesCkb from './sales-dishes/ckb';
import salesDishesEn from './sales-dishes/en';
import wholesaleAr from './wholesale/ar';
import wholesaleCkb from './wholesale/ckb';
import wholesaleEn from './wholesale/en';

/** The Studio's own catalog, separate from the public menu's. Later tasks add their groups of keys to all three files. */
export const STUDIO_MESSAGES: Record<Locale, Messages> = {
  en: { ...en, ...salesDishesEn, ...wholesaleEn, ...clinicEn },
  ar: { ...ar, ...salesDishesAr, ...wholesaleAr, ...clinicAr },
  ckb: { ...ckb, ...salesDishesCkb, ...wholesaleCkb, ...clinicCkb },
};

/**
 * A beauty centre runs on the clinic's screens with its own words: the same keys as the clinic's (a doctor is a
 * specialist, a patient a client), laid over the catalog. Only the words that differ are listed.
 */
const BEAUTY_OVERLAY: Record<Locale, Messages> = { en: beautyEn, ar: beautyAr, ckb: beautyCkb };
let beautyCatalog: Record<Locale, Messages> | undefined;

/** The catalog of one product on the clinic engine. */
export function spaceCatalog(space: 'CLINIC' | 'BEAUTY'): Record<Locale, Messages> {
  if (space === 'CLINIC') return STUDIO_MESSAGES;
  return (beautyCatalog ??= {
    en: { ...STUDIO_MESSAGES.en, ...BEAUTY_OVERLAY.en },
    ar: { ...STUDIO_MESSAGES.ar, ...BEAUTY_OVERLAY.ar },
    ckb: { ...STUDIO_MESSAGES.ckb, ...BEAUTY_OVERLAY.ckb },
  });
}

/** What the client components of a clinic or beauty page receive. */
export function clientSpaceMessages(locale: Locale, space: 'CLINIC' | 'BEAUTY'): Messages {
  return Object.fromEntries(Object.entries(spaceCatalog(space)[locale]).filter(([key]) => !key.startsWith('email.')));
}

export function getStudioTranslator(locale: Locale): Translate {
  return createTranslator(locale, STUDIO_MESSAGES);
}

/** The catalog a page's client components receive: its language's, without the email texts only the server sends. */
export function clientMessages(locale: Locale): Messages {
  return Object.fromEntries(Object.entries(STUDIO_MESSAGES[locale]).filter(([key]) => !key.startsWith('email.')));
}
