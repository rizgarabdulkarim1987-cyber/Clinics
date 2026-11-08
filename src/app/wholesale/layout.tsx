import '@/studio/studio.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { direction } from '@/lib/locale';
import { studioFontVariables } from '@/studio/fonts';
import { StudioI18nProvider } from '@/studio/i18n';
import { clientMessages } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Toaster } from '@/studio/ui/Toaster';

export const metadata: Metadata = {
  title: { default: 'Buzzify Wholesale', template: '%s · Buzzify Wholesale' },
  robots: { index: false, follow: false },
};

/**
 * The Wholesale company's root layout: the Studio's document (same stylesheet, fonts, language and direction from the
 * person's setting). One account and one sign-in serve every area; only the shell inside differs.
 */
export default async function WholesaleRootLayout({ children }: { children: ReactNode }) {
  const locale = await requestStudioLocale();
  return (
    <html lang={locale} dir={direction(locale)} className={studioFontVariables(locale)}>
      <body className="bg-surface text-text">
        <StudioI18nProvider locale={locale} messages={clientMessages(locale)}>
          {children}
          <Toaster />
        </StudioI18nProvider>
      </body>
    </html>
  );
}
