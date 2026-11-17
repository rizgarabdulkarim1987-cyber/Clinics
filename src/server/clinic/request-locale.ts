import { cookies, headers } from 'next/headers';
import type { Locale } from '@/lib/locale';
import { chooseStudioLocale, STUDIO_LOCALE_COOKIE } from '@/studio/locale';

/**
 * The interface language of a clinic request: the language switch's cookie, else `Accept-Language`. It never looks at a
 * Studio session, so a clinic page does not know whether the browser happens to be signed in to the Studio.
 */
export async function requestClinicLocale(): Promise<Locale> {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  return chooseStudioLocale({
    actorLocale: null,
    cookie: jar.get(STUDIO_LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: requestHeaders.get('accept-language'),
  });
}
