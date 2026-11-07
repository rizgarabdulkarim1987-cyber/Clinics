import { describe, expect, it } from 'vitest'
import { contrastRatio, DEFAULT_ACCENT, DEFAULT_PRIMARY, deriveTheme, deriveThemeReport, normalizeHex, ThemeError, type ThemeTokens } from '@/server/domain/wholesale/theme'

const HEX = /^#[0-9a-f]{6}$/

/** Every pair the theme promises to keep at WCAG AA (normal text, 4.5:1); up/down are semantic text colours too. */
function assertAA(t: ThemeTokens) {
  for (const v of Object.values(t)) expect(v).toMatch(HEX)
  expect(contrastRatio(t.onBrand, t.brand)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.ink, t.surface)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.muted, t.surface)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.ink, t.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.muted, t.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.ink, t.accent)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.ink, t.brandSoft)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.ink, t.accentSoft)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.up, t.surface)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(t.down, t.surface)).toBeGreaterThanOrEqual(4.5)
}

describe('deriveTheme', () => {
  it("deriveTheme('#0f5c46') has onBrand/brand contrast >= 4.5", () => {
    const t = deriveTheme('#0f5c46')
    expect(contrastRatio(t.onBrand, t.brand)).toBeGreaterThanOrEqual(4.5)
  })

  it("deriveTheme('#ffff00') (pale colour) still gives onBrand/brand >= 4.5 and muted/surface >= 4.5", () => {
    const t = deriveTheme('#ffff00')
    expect(contrastRatio(t.onBrand, t.brand)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t.muted, t.surface)).toBeGreaterThanOrEqual(4.5)
    assertAA(t)
  })

  it("deriveTheme('#0f5c46') without accent returns a valid accent", () => {
    const t = deriveTheme('#0f5c46')
    expect(t.accent).toMatch(HEX)
    expect(t.accent).not.toBe(t.brand)
    expect(t.accentSoft).toMatch(HEX)
    assertAA(t)
  })

  it('invalid hex throws ThemeError', () => {
    for (const bad of ['', 'red', '#12', '#gggggg', '#0f5c4600', '0f5c46', '#0f5c4', ' #0f5c46', '#0f5c46 ', 'url(x)', '#fff;color:red'])
      expect(() => deriveTheme(bad), bad).toThrow(ThemeError)
    expect(() => deriveTheme(null as unknown as string)).toThrow(ThemeError)
    expect(() => deriveTheme(undefined as unknown as string)).toThrow(ThemeError)
    expect(() => deriveTheme(42 as unknown as string)).toThrow(ThemeError)
    expect(() => deriveTheme('#0f5c46', 'blue')).toThrow(ThemeError)
    expect(() => deriveTheme('#0f5c46', '')).toThrow(ThemeError)
  })

  it('accepts #rgb and #rrggbb in any case and returns lowercase #rrggbb', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('#0F5C46')).toBe('#0f5c46')
    expect(deriveTheme('#0F5C46').brand).toBe('#0f5c46')
    expect(deriveTheme('#fff').brand).toMatch(HEX)
  })

  it('the default colours stay the approved dashboard reference colours', () => {
    const r = deriveThemeReport(DEFAULT_PRIMARY, DEFAULT_ACCENT)
    expect(DEFAULT_PRIMARY).toBe('#0f5c46')
    expect(DEFAULT_ACCENT).toBe('#d9822b')
    expect(r.tokens.brand).toBe('#0f5c46')
    expect(r.tokens.accent).toBe('#d9822b')
    expect(r.tokens.onBrand).toBe('#ffffff')
    expect(r.tokens.surface).toBe('#ffffff')
    expect(r.tokens.bg).toBe('#f4f3ee')
    expect(r.tokens.line).toBe('#e4e2da')
    expect(r.tokens.up).toBe('#0e6b3c')
    expect(r.tokens.down).toBe('#a82f27')
    expect(r.adjusted).toEqual({ brand: false, accent: false })
    assertAA(r.tokens)
  })

  it('a given accent is kept and gets its own soft tint', () => {
    const t = deriveTheme('#1d4ed8', '#f59e0b')
    expect(t.accent).toBe('#f59e0b')
    expect(t.accentSoft).toMatch(HEX)
    expect(t.accentSoft).not.toBe(t.brandSoft)
  })

  it('a mid-grey brand that no text colour can sit on is nudged and reported as adjusted', () => {
    const r = deriveThemeReport('#808080')
    expect(r.adjusted.brand).toBe(true)
    expect(r.tokens.brand).not.toBe('#808080')
    assertAA(r.tokens)
  })

  it('a dark accent is lightened so ink text on accent buttons stays readable', () => {
    const r = deriveThemeReport('#0f5c46', '#000080')
    expect(r.adjusted.accent).toBe(true)
    assertAA(r.tokens)
  })

  it('edge colours all satisfy AA', () => {
    for (const c of ['#ffffff', '#000000', '#ffff00', '#00ffff', '#ff00ff', '#ff0000', '#00ff00', '#0000ff', '#808080', '#777777', '#7f7f7f', '#1d4ed8', '#0000ee', '#fff', '#000'])
      for (const a of [undefined, '#ffffff', '#000000', '#808080', '#ffff00', '#0000ff']) assertAA(deriveTheme(c, a))
  })

  it('property: a deterministic random sample of 2000 colour pairs all satisfy AA with valid hex output', () => {
    // mulberry32, fixed seed: the sample is the same on every run.
    let s = 0x5eed1234
    const rand = () => {
      s = (s + 0x6d2b79f5) | 0
      let x = Math.imul(s ^ (s >>> 15), 1 | s)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
    const hex = () => `#${Math.floor(rand() * 0x1000000).toString(16).padStart(6, '0')}`
    for (let i = 0; i < 2000; i++) assertAA(deriveTheme(hex(), rand() < 0.5 ? undefined : hex()))
    // A coarse grid over the whole cube as well (every 17th step per channel: 16^3 = 4096 colours).
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) assertAA(deriveTheme(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`))
  })
})

describe('contrastRatio', () => {
  it('black on white is 21 and a colour on itself is 1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#0f5c46', '#0f5c46')).toBeCloseTo(1, 5)
  })
})
