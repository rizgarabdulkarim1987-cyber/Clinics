import '@/studio/studio.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { direction } from '@/lib/locale';
import { getWhAccess } from '@/server/wholesale/access';
import { studioFontVariables } from '@/studio/fonts';
import { StudioI18nProvider } from '@/studio/i18n';
import { clientMessages } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Toaster } from '@/studio/ui/Toaster';

/** The tab carries the company's own name once someone is signed in; the product name only before that. */
export async function generateMetadata(): Promise<Metadata> {
  let name = 'Buzzify Wholesale';
  try {
    const access = await getWhAccess();
    if (access.signedIn && access.actor?.restaurantName) name = access.actor.restaurantName;
  } catch {
    // the sign-in page and a missing company keep the product name
  }
  return { title: { default: name, template: `%s · ${name}` }, robots: { index: false, follow: false } };
}

/**
 * The Wholesale company's root layout: the Studio's document (same stylesheet, fonts, language and direction from the
 * person's setting). One account and one sign-in serve every area; only the shell inside differs.
 */
export default async function WholesaleRootLayout({ children }: { children: ReactNode }) {
  const locale = await requestStudioLocale();
  return (
    <html lang={locale} dir={direction(locale)} className={studioFontVariables(locale)}>
      <body className="wh bg-wh-canvas text-text">
        <StudioI18nProvider locale={locale} messages={clientMessages(locale)}>
          {children}
          <Toaster />
        </StudioI18nProvider>
      </body>
    </html>
  );
}
