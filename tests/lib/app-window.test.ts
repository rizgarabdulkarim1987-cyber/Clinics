import { describe, expect, it } from 'vitest';
import { shouldFill } from '@/lib/app-window';

describe('shouldFill', () => {
  it('asks for a bigger window when the app opened small, and leaves a big one alone', () => {
    expect(shouldFill({ width: 800, height: 600 }, { width: 1920, height: 1040 })).toBe(true);
    expect(shouldFill({ width: 1920, height: 600 }, { width: 1920, height: 1040 })).toBe(true);
    expect(shouldFill({ width: 1900, height: 1030 }, { width: 1920, height: 1040 })).toBe(false);
    expect(shouldFill({ width: 1920, height: 1040 }, { width: 1920, height: 1040 })).toBe(false);
  });
  it('does nothing when the screen size is unknown', () => {
    expect(shouldFill({ width: 800, height: 600 }, { width: 0, height: 0 })).toBe(false);
  });
});
