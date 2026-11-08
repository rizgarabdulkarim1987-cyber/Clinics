'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Keeps a server-rendered screen current: re-reads it every `seconds` while the tab is visible, and once more when
 * the user comes back to the tab. Short polling first; a push channel can replace it without touching the screens.
 */
export function LiveRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = window.setInterval(tick, seconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, seconds]);
  return null;
}
