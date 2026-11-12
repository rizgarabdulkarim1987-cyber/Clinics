import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { AuthEntry } from '@/studio/auth-entry';
import { BrandFooter } from './BrandFooter';
import { BrandLogo } from './BrandLogo';
import { LanguageSwitch } from './LanguageSwitch';
import { Wordmark } from './Wordmark';

/** The products Business Core runs, as buzzify.me/business_core lists them. Product names stay Latin, like the brand's. */
const PRODUCTS = ['Menu', 'Cashier', 'Pharmacy', 'Supermarket', 'Electronics', 'Clothing', 'Wholesale'] as const;

/**
 * The frame of the pages around signing in, in the Buzzify brand world (black, electric blue, mono labels; the look of
 * buzzify.me/business_core): the product's mark and the language switch above the form. For the Studio (`entry`
 * "studio") the mark is "Buzzify Core" and, on wide screens, the line the guideline leads with and the products the
 * control room keeps in order stand beside it. From Buzzify Retail (`entry` "retail") the mark is the Buzzify logo alone
 * and nothing stands beside the form: no Studio, no menus.
 */
export function AuthFrame({ entry, t, signedIn, children }: { entry: AuthEntry; t: Translate; signedIn: boolean; children: ReactNode }) {
  const neutral = entry === 'retail';
  return (
    <div
      className={
        neutral
          ? 'auth-world flex min-h-dvh flex-col bg-bg text-text'
          : 'auth-world grid min-h-dvh bg-bg text-text lg:grid-cols-[minmax(0,1fr)_minmax(440px,48%)]'
      }
    >
      <div className="auth-form-side relative flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
        >
          {t('common.skipToContent')}
        </a>
        <header className="relative z-10 flex h-16 items-center justify-between gap-4 px-6 sm:px-8">
          {neutral ? <BrandLogo height={16} /> : <Wordmark />}
          <LanguageSwitch signedIn={signedIn} />
        </header>
        <main id="main" className="relative z-10 flex flex-1 flex-col justify-center px-6 pb-24 pt-10 sm:px-8">
          {children}
        </main>
        <BrandFooter />
      </div>

      {!neutral && (
        <aside
          aria-hidden="true"
          className="auth-stage relative hidden flex-col justify-between overflow-hidden border-s border-line px-12 py-12 lg:flex"
        >
          <p dir="ltr" lang="en" className="auth-eyebrow relative z-10">
            <span className="auth-dot" />
            Buzzify Business Core
          </p>

          <div className="relative z-10">
            <p className="auth-headline">
              <span className="block">{t('auth.stage.line1')}</span>
              <span className="auth-headline-lit block">{t('auth.stage.line2')}</span>
            </p>
            <p className="mt-6 max-w-[40ch] text-base leading-relaxed text-muted">{t('auth.aside')}</p>
          </div>

          <div className="relative z-10">
            <p className="auth-eyebrow auth-eyebrow-dim mb-4">{t('auth.stage.products')}</p>
            <ul dir="ltr" lang="en" className="grid grid-cols-2 border-t border-line xl:grid-cols-3">
              {PRODUCTS.map((name, index) => (
                <li key={name} className="auth-product flex items-baseline gap-3 border-b border-line py-3">
                  <span className="auth-eyebrow auth-eyebrow-dim">{String(index + 1).padStart(2, '0')}</span>
                  <span className="text-md font-medium">{name}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}
