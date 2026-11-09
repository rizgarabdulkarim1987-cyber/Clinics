import '@/studio/studio.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { direction } from '@/lib/locale';
import { getActor } from '@/server/studio/auth/actor';
import { appearanceHtmlProps } from '@/studio/appearance-html';
import { studioFontVariables } from '@/studio/fonts';
import { StudioI18nProvider } from '@/studio/i18n';
import { clientMessages } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Toaster } from '@/studio/ui/Toaster';
import { AppWindow } from './_ui/AppWindow';

/** The books scroll as always, but no scrollbar is drawn: the screen is one page and the bar only took space. */
const NO_SCROLLBARS = '*{scrollbar-width:none}*::-webkit-scrollbar{display:none}';

export const metadata: Metadata = {
  title: { default: 'Buzzify Agency', template: '%s · Buzzify Agency' },
  robots: { index: false, follow: false },
  // Lets Chrome and Edge install the books as a desktop app with its own window.
  manifest: '/agency/manifest',
  icons: { icon: '/agency/icon-192.png', apple: '/agency/icon-192.png' },
};

/**
 * The agency books' root layout. Like the till, it is the Studio's document (same stylesheet, fonts, language and
 * direction from the person's setting) because one account and one sign-in serve every area; the page inside has no
 * navigation, as the books are one screen (docs/superpowers/specs/2026-11-09-agency-accounts-design.md).
 */
export default async function AgencyRootLayout({ children }: { children: ReactNode }) {
  const [locale, actor] = await Promise.all([requestStudioLocale(), getActor()]);
  return (
    <html lang={locale} dir={direction(locale)} className={studioFontVariables(locale)} {...appearanceHtmlProps(actor?.appearance)}>
      <body>
        <StudioI18nProvider locale={locale} messages={clientMessages(locale)}>
          <style>{NO_SCROLLBARS}</style>
          <AppWindow />
          {children}
          <Toaster />
        </StudioI18nProvider>
      </body>
    </html>
  );
}
