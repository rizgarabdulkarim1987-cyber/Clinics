import '@/studio/studio.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { direction } from '@/lib/locale';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { requestSpace } from '@/server/clinic/request-space';
import { studioFontVariables } from '@/studio/fonts';
import { StudioI18nProvider } from '@/studio/i18n';
import { clientSpaceMessages } from '@/studio/messages';
import { Toaster } from '@/studio/ui/Toaster';

export const metadata: Metadata = {
  title: { default: 'Buzzify Clinics', template: '%s · Buzzify Clinics' },
  robots: { index: false, follow: false },
};

/** The clinic app's root layout: the Studio's document (stylesheet, fonts, direction) with the clinic's own language choice. */
export default async function ClinicRootLayout({ children }: { children: ReactNode }) {
  const [locale, space] = await Promise.all([requestClinicLocale(), requestSpace()]);
  return (
    <html lang={locale} dir={direction(locale)} className={studioFontVariables(locale)}>
      <body className="bg-canvas text-text">
        <StudioI18nProvider locale={locale} messages={clientSpaceMessages(locale, space)}>
          {children}
          <Toaster />
        </StudioI18nProvider>
      </body>
    </html>
  );
}
