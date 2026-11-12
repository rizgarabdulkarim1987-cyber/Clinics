'use client';

import { useEffect } from 'react';

/**
 * A roll printer needs a page exactly as tall as the receipt: Chrome ignores "size: 80mm auto", so measure the receipt
 * (without the on-screen buttons) and set the page to 80 mm x that height.
 */
export function FitReceipt() {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-receipt]');
    if (!el) return;
    const screenOnly = Array.from(el.querySelectorAll<HTMLElement>('[data-screen-only]')).reduce((n, x) => n + x.offsetHeight, 0);
    const mm = Math.ceil(((el.offsetHeight - screenOnly) * 25.4) / 96) + 10;
    const style = document.createElement('style');
    style.textContent = `@page { size: 80mm ${mm}mm; margin: 3mm }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  return null;
}
