import type { WhRole as Role } from '@/server/domain/wholesale/permissions'

/*
 * Live updates: the event contract shared by the server (src/server/realtime.ts, the SSE route) and the browser
 * (src/lib/useLive.ts). Pure, no I/O, safe to import from client code.
 *
 * An event says only THAT something changed and where: a channel, a kind, and opaque ids. Never an amount, a cost, a
 * price, a profit or a name: a Postgres NOTIFY payload is visible to every session LISTENing on the database, it is
 * capped at 8000 bytes, and the client does not need it anyway: it refetches through the normal, authorised server
 * rendering (router.refresh()), which applies the role rules. The SSE route still filters every event again per
 * user (forwardFor) with a per-role key allowlist, so a field that ever slipped into a payload is never forwarded.
 */

export const LIVE_CHANNELS = ['stock', 'sales', 'rates', 'dashboard'] as const
export type LiveChannel = (typeof LIVE_CHANNELS)[number]

/** What can happen on each channel. Anything else in a notification is dropped. */
export const LIVE_KINDS = {
  /** move: a quantity changed in `warehouseId`; recost: only its average cost changed (never sent to a REP). */
  stock: ['move', 'recost'],
  sales: ['sale', 'approve', 'reject', 'cancel', 'payment', 'return'],
  rates: ['rate'],
  dashboard: ['expense', 'handover', 'conversion', 'purchase', 'supplier-payment', 'purchase-return', 'count', 'opening'],
} as const satisfies Record<LiveChannel, readonly string[]>
export type LiveKind<C extends LiveChannel = LiveChannel> = (typeof LIVE_KINDS)[C][number]

/** The optional fields: opaque ids (uuids) and a date, nothing else. */
const FIELDS = ['id', 'warehouseId', 'repId', 'date'] as const
type Field = (typeof FIELDS)[number]

export type LivePayload<C extends LiveChannel = LiveChannel> = { kind: LiveKind<C> } & Partial<Record<Field, string>>
export type LiveEvent = { channel: LiveChannel; kind: string } & Partial<Record<Field, string>>

/** The fixed Postgres NOTIFY channel; the event's own channel travels in the JSON payload. */
export const PG_CHANNEL = 'live'
/** Upper bound for an encoded event (Postgres allows 8000 bytes; ours are ~150). */
export const MAX_PAYLOAD_BYTES = 1024
const VALUE = /^[A-Za-z0-9_.:-]{1,64}$/

export class LivePayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LivePayloadError'
  }
}

export const isLiveChannel = (v: unknown): v is LiveChannel => typeof v === 'string' && (LIVE_CHANNELS as readonly string[]).includes(v)
const isKind = (channel: LiveChannel, v: unknown): boolean => typeof v === 'string' && (LIVE_KINDS[channel] as readonly string[]).includes(v)

/** Validate and serialise an event for NOTIFY. Throws LivePayloadError on an unknown channel/kind/field or a bad or oversized value. */
export function encodeLiveEvent(channel: LiveChannel, payload: LivePayload): string {
  if (!isLiveChannel(channel)) throw new LivePayloadError(`unknown live channel: ${String(channel)}`)
  if (!payload || typeof payload !== 'object') throw new LivePayloadError('payload is required')
  if (!isKind(channel, payload.kind)) throw new LivePayloadError(`unknown ${channel} kind: ${String(payload.kind)}`)
  const out: LiveEvent = { channel, kind: payload.kind }
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'kind' || v === undefined || v === null) continue
    if (!(FIELDS as readonly string[]).includes(k)) throw new LivePayloadError(`field not allowed in a live event: ${k}`)
    if (typeof v !== 'string' || !VALUE.test(v)) throw new LivePayloadError(`bad value for ${k} (ids and dates only, at most 64 characters)`)
    out[k as Field] = v
  }
  const text = JSON.stringify(out)
  if (new TextEncoder().encode(text).length > MAX_PAYLOAD_BYTES) throw new LivePayloadError('live event too large')
  return text
}

/** Parse a notification. null for anything that is not a well-formed event (oversized, not JSON, unknown channel or kind, bad values): never throws. */
export function decodeLiveEvent(text: unknown): LiveEvent | null {
  if (typeof text !== 'string' || text.length > MAX_PAYLOAD_BYTES) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!isLiveChannel(r.channel) || !isKind(r.channel, r.kind)) return null
  const ev: LiveEvent = { channel: r.channel, kind: r.kind as string }
  for (const k of FIELDS) {
    const v = r[k]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string' || !VALUE.test(v)) return null
    ev[k] = v
  }
  return ev
}

/** Keys each role may receive. A REP never gets repId (it is always its own) or anything not listed. */
export const ROLE_KEYS: Record<Role, readonly (keyof LiveEvent)[]> = {
  OWNER: ['channel', 'kind', 'id', 'warehouseId', 'repId', 'date'],
  PARTNER: ['channel', 'kind', 'id', 'warehouseId', 'repId', 'date'],
  REP: ['channel', 'kind', 'id', 'warehouseId', 'date'],
}

/** Who the stream is for: the user, and for a REP the warehouses whose quantities it may see (MAIN and its own). */
export type LiveAudience = { userId: string; role: Role; warehouseIds: ReadonlySet<string> }

/**
 * The event as this user may receive it, or null. OWNER/PARTNER: every event. REP: its own sales and dashboard
 * events (repId = the user), quantity moves of the main and its own warehouse, rates; never a re-cost, another rep's
 * events, or events without a rep (office sales, purchases). Then only the role's allowlisted keys are kept.
 */
export function forwardFor(a: LiveAudience, channels: ReadonlySet<LiveChannel>, ev: LiveEvent): Partial<LiveEvent> | null {
  if (!channels.has(ev.channel)) return null
  if (a.role === 'REP') {
    const ok =
      ev.channel === 'rates' ||
      (ev.channel === 'stock' && ev.kind === 'move' && !!ev.warehouseId && a.warehouseIds.has(ev.warehouseId)) ||
      ((ev.channel === 'sales' || ev.channel === 'dashboard') && ev.repId === a.userId)
    if (!ok) return null
  } else if (a.role !== 'OWNER' && a.role !== 'PARTNER') return null
  const out: Partial<LiveEvent> = {}
  for (const k of ROLE_KEYS[a.role]) if (ev[k] !== undefined) (out as Record<string, unknown>)[k] = ev[k]
  return out
}

/** Parse `channels=a,b` (absent = all). null when any name is not a live channel, or the list is empty. */
export function parseChannels(param: string | null): Set<LiveChannel> | null {
  if (param === null) return new Set(LIVE_CHANNELS)
  const names = param.split(',').map((s) => s.trim())
  if (!names.length || names.length > LIVE_CHANNELS.length * 2 || !names.every(isLiveChannel)) return null
  return new Set(names as LiveChannel[])
}
