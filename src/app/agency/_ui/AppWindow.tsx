'use client';

import { useEffect } from 'react';
import { shouldFill } from '@/lib/app-window';

/**
 * In the installed desktop app (its own window, no browser bar) the window opens large: when it starts clearly smaller than
 * the usable screen it is moved to the corner and stretched over it. In a normal browser tab it does nothing.
 */
export function AppWindow() {
  useEffect(() => {
    if (!window.matchMedia('(display-mode: standalone)').matches) return;
    const usable = { width: window.screen.availWidth, height: window.screen.availHeight };
    if (!shouldFill({ width: window.outerWidth, height: window.outerHeight }, usable)) return;
    try {
      const area = window.screen as Screen & { availLeft?: number; availTop?: number };
      window.moveTo(area.availLeft ?? 0, area.availTop ?? 0);
      window.resizeTo(usable.width, usable.height);
    } catch {
      // A window that may not be resized stays as it is.
    }
  }, []);
  return null;
}
