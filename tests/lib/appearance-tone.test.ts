import { describe, expect, it } from 'vitest';
import { checkAppearance, DEFAULT_APPEARANCE, fullAppearanceVars, PRESETS, switchTone, toneOf } from '@/lib/appearance';

const dark = PRESETS.find((preset) => preset.key === 'dark')!.appearance;

describe('switchTone', () => {
  it('goes from the light default to the dark look, and back', () => {
    expect(switchTone(DEFAULT_APPEARANCE)).toEqual(dark);
    expect(switchTone(dark)).toEqual(DEFAULT_APPEARANCE);
  });

  it('treats a person who never chose anything as light', () => {
    expect(switchTone(null)).toEqual(dark);
    expect(switchTone(undefined)).toEqual(dark);
  });

  it('keeps the font and the button shape the person chose', () => {
    const chosen = { ...DEFAULT_APPEARANCE, font: 'serif' as const, shape: 'round' as const };
    expect(switchTone(chosen)).toEqual({ ...dark, font: 'serif', shape: 'round' });
    expect(switchTone({ ...dark, font: 'rounded', shape: 'round' })).toEqual({ ...DEFAULT_APPEARANCE, font: 'rounded', shape: 'round' });
  });

  it('turns any dark background light and any light one dark, and always passes the readability check', () => {
    for (const preset of PRESETS) {
      const next = switchTone(preset.appearance);
      expect(toneOf(next.bg)).not.toBe(toneOf(preset.appearance.bg));
      expect(checkAppearance(next).ok).toBe(true);
    }
  });
});

describe('the amber highlight', () => {
  it('is a deep amber on a dark page and left to the stylesheet on a light one', () => {
    expect(fullAppearanceVars(dark)['--s-accent-wash']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(fullAppearanceVars(DEFAULT_APPEARANCE)['--s-accent-wash']).toBeUndefined();
  });
});
