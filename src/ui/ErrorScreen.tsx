'use client';

import { useEffect } from 'react';
import { errorCopy } from './error-copy';

/**
 * The body of every area's `error.tsx`. It depends on nothing the area provides (no providers, no message catalog, no
 * stylesheet classes), because it renders when something in the area has already failed. It shows the three languages
 * at once and a retry that re-renders the failed segment; the rest of the app, and the other areas, keep working.
 */
export function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      role="alert"
      style={{ display: 'flex', minHeight: '100dvh', flexDirection: 'column', justifyContent: 'center', gap: 12, maxWidth: 420, margin: '0 auto', padding: '0 24px' }}
    >
      {(['en', 'ar', 'ckb'] as const).map((locale) => (
        <p key={locale} lang={locale} dir={locale === 'en' ? 'ltr' : 'rtl'} style={{ margin: 0 }}>
          {errorCopy[locale].title}
        </p>
      ))}
      <button
        type="button"
        onClick={reset}
        style={{ minHeight: 44, width: 'fit-content', padding: '0 20px', borderRadius: 999, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' }}
      >
        {errorCopy.en.retry} · {errorCopy.ar.retry} · {errorCopy.ckb.retry}
      </button>
    </main>
  );
}
