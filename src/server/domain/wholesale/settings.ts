/* Company settings: typed keys, their defaults and per-key Zod validation (stored by src/server/settings.ts). */

import { z } from 'zod'
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, isHex, normalizeHex } from '@/server/domain/wholesale/theme'

export const CREDIT_LIMIT_MODES = ['WARN', 'BLOCK'] as const
export type CreditLimitMode = (typeof CREDIT_LIMIT_MODES)[number]

export const SETTING_CURRENCIES = ['IQD', 'USD', 'IRT'] as const
export type SettingCurrency = (typeof SETTING_CURRENCIES)[number]

/** Every setting key with the type of its value. */
export type SettingValues = {
  /** Shown in the sidebar instead of the app name; '' means "use the app name". */
  companyName: string
  /** '' (none), a site-relative path like `/logo.png` (served from public/), or an https URL. Only stored and shown, never fetched by the server. */
  logoPath: string
  /** The company's required theme colour (hex). */
  themePrimary: string
  /** The optional second colour (hex); null means derive it from themePrimary. */
  themeAccent: string | null
  /** Days of sales history the stock-cover forecast averages over (Task 13b). */
  forecastWindowDays: number
  /** Supplier lead time in days: cover below this raises a low-cover alert (Task 13b). */
  reorderLeadDays: number
  /** A REP's percent or manual price waits for owner/partner approval before anything is posted. */
  requireApproval: boolean
  /** A credit sale above the customer's credit limit: post with a warning, or refuse. */
  creditLimitMode: CreditLimitMode
  /** Batches expiring within this many days are flagged (Phase 2). */
  expiryAlertDays: number
  /** Barcode scanning on sale and stock screens (Phase 2). */
  barcodeEnabled: boolean
  /** Currency new documents start in (Phase 2). */
  defaultCurrency: SettingCurrency
}
export type SettingKey = keyof SettingValues

export const SETTING_DEFAULTS: SettingValues = {
  companyName: '',
  logoPath: '',
  themePrimary: DEFAULT_PRIMARY,
  themeAccent: DEFAULT_ACCENT,
  forecastWindowDays: 30,
  reorderLeadDays: 14,
  requireApproval: false,
  creditLimitMode: 'WARN',
  expiryAlertDays: 30,
  barcodeEnabled: false,
  defaultCurrency: 'IQD',
}

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as readonly SettingKey[]

/** Bounds for the day-count settings (also used for the form's min/max). */
export const DAY_BOUNDS = {
  forecastWindowDays: { min: 7, max: 365 },
  reorderLeadDays: { min: 1, max: 180 },
  expiryAlertDays: { min: 1, max: 365 },
} as const

/** An unknown setting key or a value of the wrong type. Nothing was written. */
export class InvalidSettingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSettingError'
  }
}

// A site-relative path: segments of letters, digits, '_', '-', '.', never starting with '.' (so no '..', no hidden files).
const RELATIVE_PATH = /^(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/
const CONTROL = /[\u0000-\u001f\u007f]/

function isSafeHttpsUrl(v: string): boolean {
  if (!/^https:\/\/[^\s"'<>\\]+$/.test(v)) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && u.hostname !== '' && u.username === '' && u.password === ''
  } catch {
    return false
  }
}

const hex = z.string().refine(isHex, 'hex colour (#rgb or #rrggbb)')
const days = (k: keyof typeof DAY_BOUNDS) => z.int().min(DAY_BOUNDS[k].min).max(DAY_BOUNDS[k].max)

const SCHEMAS: { [K in SettingKey]: z.ZodType<SettingValues[K]> } = {
  companyName: z.string().max(80).refine((v) => !CONTROL.test(v), 'no control characters'),
  logoPath: z.string().max(300).refine((v) => v === '' || RELATIVE_PATH.test(v) || isSafeHttpsUrl(v), 'relative path or https URL'),
  themePrimary: hex,
  themeAccent: hex.nullable(),
  forecastWindowDays: days('forecastWindowDays'),
  reorderLeadDays: days('reorderLeadDays'),
  requireApproval: z.boolean(),
  creditLimitMode: z.enum(CREDIT_LIMIT_MODES),
  expiryAlertDays: days('expiryAlertDays'),
  barcodeEnabled: z.boolean(),
  defaultCurrency: z.enum(SETTING_CURRENCIES),
}

export const isSettingKey = (k: unknown): k is SettingKey => typeof k === 'string' && Object.hasOwn(SCHEMAS, k)

const isValid = <K extends SettingKey>(key: K, v: unknown): v is SettingValues[K] => SCHEMAS[key].safeParse(v).success

/** Throws InvalidSettingError unless `value` is valid for `key`. */
export function assertSetting<K extends SettingKey>(key: K, value: unknown): asserts value is SettingValues[K] {
  if (!isSettingKey(key)) throw new InvalidSettingError(`unknown setting: ${String(key)}`)
  if (!isValid(key, value)) throw new InvalidSettingError(`invalid value for ${key}: ${JSON.stringify(value)}`)
}

/** A stored value, or the default when it is missing or (after a bad manual edit) invalid. */
export function settingOrDefault<K extends SettingKey>(key: K, stored: unknown): SettingValues[K] {
  return stored !== undefined && isValid(key, stored) ? stored : SETTING_DEFAULTS[key]
}

/**
 * The settings form's fields as typed values, or null if any is invalid. Text is trimmed, hex colours normalized,
 * an unticked checkbox is false, and the `accentAuto` box stores a null accent (derived from the primary).
 */
export function settingsFromForm(fd: FormData): SettingValues | null {
  const str = (k: string) => {
    const v = fd.get(k)
    return typeof v === 'string' ? v.trim() : ''
  }
  const int = (k: string) => (/^\d{1,4}$/.test(str(k)) ? Number(str(k)) : NaN)
  const colour = (k: string) => (isHex(str(k)) ? normalizeHex(str(k)) : str(k))
  const values = {
    companyName: str('companyName'),
    logoPath: str('logoPath'),
    themePrimary: colour('themePrimary'),
    themeAccent: fd.get('accentAuto') !== null ? null : colour('themeAccent'),
    forecastWindowDays: int('forecastWindowDays'),
    reorderLeadDays: int('reorderLeadDays'),
    requireApproval: fd.get('requireApproval') !== null,
    creditLimitMode: str('creditLimitMode'),
    expiryAlertDays: int('expiryAlertDays'),
    barcodeEnabled: fd.get('barcodeEnabled') !== null,
    defaultCurrency: str('defaultCurrency'),
  }
  return SETTING_KEYS.every((k) => isValid(k, values[k])) ? (values as SettingValues) : null
}
