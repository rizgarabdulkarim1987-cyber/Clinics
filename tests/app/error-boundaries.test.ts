import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorCopy } from '@/ui/error-copy';

/** Each area of the app has its own root layout, so each needs its own boundary: one area's crash stays in it. */
const AREAS = ['[tenant]/[locale]', '[tenant]/intro', 'studio/(studio)', 'pos', 'pharmacy', 'agency'];

describe('error boundaries', () => {
  it.each(AREAS)('%s has an error.tsx that is a client component', (area) => {
    const file = join(process.cwd(), 'src/app', area, 'error.tsx');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toMatch(/^['"]use client['"]/);
  });
});

describe('errorCopy', () => {
  it('says what happened and offers a retry in all three languages', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      const copy = errorCopy[locale];
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.retry.length).toBeGreaterThan(0);
    }
  });
});
