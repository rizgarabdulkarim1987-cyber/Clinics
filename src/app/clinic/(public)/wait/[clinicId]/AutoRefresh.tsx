'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const REFRESH_MS = 8000;

/** Asks the server for the page again every few seconds, so the screen on the wall follows the day board. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
