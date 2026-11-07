/*
 * Company theme: one required colour (primary) and one optional second colour (accent); every other colour is derived
 * here and kept at WCAG AA. Pure, no dependencies, so the settings page can run it in the browser for the live preview.
 *
 * Rules (each one terminates for any valid hex: lightness moves in 0.01 steps between 0 and 1, at most 101 tries,
 * and both ends, black and white, satisfy the test being searched for):
 * - brand = primary as given when white or ink text reaches 4.5:1 on it (white preferred); otherwise its lightness is
 *   nudged (darker until white passes, or lighter until ink passes, whichever is fewer steps) and `adjusted.brand` is set.
 * - accent = the given accent, else primary rotated 227 degrees (the rotation that takes the default green to the
 *   default amber) at saturation 0.55-0.75 and lightness 0.51. Accent is a button background under ink text, so it is
 *   lightened until ink reaches 4.5:1; a given accent that had to move sets `adjusted.accent`.
 * - surface, bg and line are the approved warm neutrals for every company; up/down are the approved semantic green/red.
 * - ink and muted take the brand's hue at low saturation and are darkened until they reach 4.5:1 on surface and bg.
 * - brandSoft/accentSoft are pale tints of brand/accent (ink stays >= 4.5:1 on them).
 */

export type ThemeTokens = {
  brand: string
  brandSoft: string
  onBrand: string
  accent: string
  accentSoft: string
  surface: string
  bg: string
  ink: string
  muted: string
  line: string
  up: string
  down: string
}

export type ThemeReport = { tokens: ThemeTokens; adjusted: { brand: boolean; accent: boolean } }

/** The approved dashboard reference colours (docs/design/dashboard-reference.html). */
export const DEFAULT_PRIMARY = '#0f5c46'
export const DEFAULT_ACCENT = '#d9822b'

/** WCAG AA for normal text. */
export const AA = 4.5

const WHITE = '#ffffff'
const BLACK = '#000000'
const NEUTRALS = { surface: '#ffffff', bg: '#f4f3ee', line: '#e4e2da', up: '#0e6b3c', down: '#a82f27' } as const

/** A colour that is not `#rgb` or `#rrggbb`. */
export class ThemeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThemeError'
  }
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX_RE.test(v)

/** `#rgb` or `#rrggbb` (any case) as lowercase `#rrggbb`; anything else throws ThemeError. */
export function normalizeHex(v: unknown): string {
  if (!isHex(v)) throw new ThemeError(`not a hex colour: ${JSON.stringify(v)}`)
  const s = v.slice(1).toLowerCase()
  return `#${s.length === 3 ? [...s].map((c) => c + c).join('') : s}`
}

type RGB = [number, number, number]
type HSL = [number, number, number]

const hexToRgb = (hex: string): RGB => {
  const n = parseInt(normalizeHex(hex).slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgbToHex = (rgb: RGB): string => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`

function rgbToHsl([r, g, b]: RGB): HSL {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === R ? 60 * (((G - B) / d + 6) % 6) : max === G ? 60 * ((B - R) / d + 2) : 60 * ((R - G) / d + 4)
  return [h, Math.min(1, s), l]
}

function hslToRgb([h, s, l]: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

const hsl = (h: number, s: number, l: number) => rgbToHex(hslToRgb([h, s, l]))
const toHsl = (hex: string) => rgbToHsl(hexToRgb(hex))

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const readsOn = (fg: string, ...bgs: string[]) => bgs.every((bg) => contrastRatio(fg, bg) >= AA)

/**
 * The first colour, moving `hex`'s HSL lightness in 0.01 steps (hue and saturation kept), that passes `ok`.
 * At most 101 tries; the last is black (darker) or white (lighter). Returns null if even that fails.
 */
function nudge(hex: string, ok: (c: string) => boolean, dir: 'darker' | 'lighter'): { hex: string; steps: number } | null {
  const [h, s, l0] = toHsl(hex)
  let l = l0
  for (let steps = 0; steps <= 100; steps++) {
    const c = steps === 0 ? hex : hsl(h, s, l)
    if (ok(c)) return { hex: c, steps }
    l = dir === 'darker' ? Math.max(0, l - 0.01) : Math.min(1, l + 0.01)
  }
  const end = dir === 'darker' ? BLACK : WHITE
  return ok(end) ? { hex: end, steps: 101 } : null
}

/** Full derivation with a note of which chosen colours had to move to keep AA. */
export function deriveThemeReport(primary: string, accent?: string | null): ThemeReport {
  const p = normalizeHex(primary)
  const given = accent === undefined || accent === null ? null : normalizeHex(accent)
  const [h, s] = toHsl(p)
  const { surface, bg } = NEUTRALS

  // Text colours: the brand hue at low saturation (none for a grey brand), darkened until AA on surface and bg.
  const ink = nudge(hsl(h, Math.min(s, 0.12), 0.125), (c) => readsOn(c, surface, bg), 'darker')?.hex ?? BLACK
  const muted = nudge(hsl(h, Math.min(s, 0.06), 0.353), (c) => readsOn(c, surface, bg), 'darker')?.hex ?? ink

  // Brand and the text that sits on it (the sidebar).
  let brand = p
  let onBrand = WHITE
  if (!readsOn(WHITE, p)) {
    if (readsOn(ink, p)) onBrand = ink
    else {
      const down = nudge(p, (c) => readsOn(WHITE, c), 'darker')
      const up = nudge(p, (c) => readsOn(ink, c), 'lighter')
      if (up && (!down || up.steps < down.steps)) [brand, onBrand] = [up.hex, ink]
      else [brand, onBrand] = [down?.hex ?? BLACK, WHITE]
    }
  }

  // Accent: a button background under ink text.
  const [bh, bs] = toHsl(brand)
  const rawAccent = given ?? hsl(h + 227, Math.min(0.75, Math.max(0.55, s)), 0.51)
  const finalAccent = nudge(rawAccent, (c) => readsOn(ink, c), 'lighter')?.hex ?? WHITE
  const [ah, as] = toHsl(finalAccent)

  const soft = (hex: string) => nudge(hex, (c) => readsOn(ink, c), 'lighter')?.hex ?? WHITE
  const tokens: ThemeTokens = {
    brand,
    brandSoft: soft(hsl(bh, Math.min(bs, 0.32), 0.91)),
    onBrand,
    accent: finalAccent,
    accentSoft: soft(hsl(ah, Math.min(as, 0.8), 0.92)),
    surface,
    bg,
    ink,
    muted,
    line: NEUTRALS.line,
    up: NEUTRALS.up,
    down: NEUTRALS.down,
  }
  return { tokens, adjusted: { brand: brand !== p, accent: given !== null && finalAccent !== given } }
}

/** Theme tokens (lowercase `#rrggbb`) from one required and one optional colour. Throws ThemeError on a bad hex. */
export function deriveTheme(primary: string, accent?: string | null): ThemeTokens {
  return deriveThemeReport(primary, accent).tokens
}

/** CSS custom-property names for each token (the names globals.css already uses). */
export const THEME_CSS_VARS: Record<keyof ThemeTokens, string> = {
  brand: '--brand',
  brandSoft: '--brand-soft',
  onBrand: '--on-brand',
  accent: '--accent',
  accentSoft: '--accent-soft',
  surface: '--surface',
  bg: '--bg',
  ink: '--ink',
  muted: '--muted',
  line: '--line',
  up: '--up',
  down: '--down',
}

/** Tokens as a React style object of CSS variables. Values are deriveTheme output (validated hex) only. */
export function themeStyle(tokens: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(THEME_CSS_VARS) as (keyof ThemeTokens)[]) {
    const v = tokens[k]
    if (!/^#[0-9a-f]{6}$/.test(v)) throw new ThemeError(`token ${k} is not a hex colour`)
    out[THEME_CSS_VARS[k]] = v
  }
  return out
}

/** The theme for stored settings, falling back to the default theme if the stored colours are somehow invalid. */
export function themeFromSettings(primary: unknown, accent: unknown): ThemeReport {
  try {
    return deriveThemeReport(primary as string, accent as string | null | undefined)
  } catch {
    return deriveThemeReport(DEFAULT_PRIMARY, DEFAULT_ACCENT)
  }
}
