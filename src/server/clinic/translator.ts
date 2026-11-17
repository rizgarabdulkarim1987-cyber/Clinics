import { createTranslator, type Translate } from '@/lib/i18n';
import { spaceCatalog } from '@/studio/messages';
import { requestClinicLocale } from './request-locale';
import { requestSpace } from './request-space';

/** The translator of the current request: the Studio catalog, with a beauty centre's own words over it on `/beauty`. */
export async function clinicTranslator(): Promise<Translate> {
  const [locale, space] = await Promise.all([requestClinicLocale(), requestSpace()]);
  return createTranslator(locale, spaceCatalog(space));
}
