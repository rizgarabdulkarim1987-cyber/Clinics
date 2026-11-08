import { describe, expect, it } from 'vitest'
import { LIVE_CHANNELS, LivePayloadError, decodeLiveEvent, encodeLiveEvent, forwardFor, parseChannels, type LiveAudience, type LiveEvent } from '@/server/domain/wholesale/live'

const all = new Set(LIVE_CHANNELS)
const owner: LiveAudience = { userId: 'o', role: 'OWNER', warehouseIds: new Set() }
const rep: LiveAudience = { userId: 'r1', role: 'REP', warehouseIds: new Set(['main', 'w1']) }

describe('live event contract', () => {
  it('encodes ids only and refuses anything else', () => {
    expect(JSON.parse(encodeLiveEvent('sales', { kind: 'sale', id: 'a-1', repId: 'r1' }))).toEqual({ channel: 'sales', kind: 'sale', id: 'a-1', repId: 'r1' })
    expect(() => encodeLiveEvent('sales', { kind: 'sale', ...({ totalCostIqd: '5' } as object) } as never)).toThrow(LivePayloadError)
    expect(() => encodeLiveEvent('sales', { kind: 'nope' } as never)).toThrow(LivePayloadError)
    expect(() => encodeLiveEvent('costs' as never, { kind: 'sale' } as never)).toThrow(LivePayloadError)
    expect(() => encodeLiveEvent('sales', { kind: 'sale', id: 'x'.repeat(65) })).toThrow(LivePayloadError)
    expect(() => encodeLiveEvent('sales', { kind: 'sale', id: "a'; DROP" })).toThrow(LivePayloadError)
  })

  it('decodes defensively: never throws, drops unknown keys, rejects bad values', () => {
    for (const bad of ['', 'not json', '[]', 'null', '{"channel":"sales","kind":"x"}', '{"channel":"x","kind":"sale"}', JSON.stringify({ channel: 'sales', kind: 'sale', id: 'y'.repeat(2000) }), 42])
      expect(decodeLiveEvent(bad)).toBeNull()
    expect(decodeLiveEvent(JSON.stringify({ channel: 'sales', kind: 'sale', id: 's', costIqd: '1' }))).toEqual({ channel: 'sales', kind: 'sale', id: 's' })
  })

  it('forwards everything to OWNER and only own / allowed events to a REP, without repId', () => {
    const ev = (e: LiveEvent) => e
    expect(forwardFor(owner, all, ev({ channel: 'sales', kind: 'sale', id: 's', repId: 'r2' }))).toEqual({ channel: 'sales', kind: 'sale', id: 's', repId: 'r2' })
    expect(forwardFor(rep, all, ev({ channel: 'sales', kind: 'sale', id: 's', repId: 'r2' }))).toBeNull()
    expect(forwardFor(rep, all, ev({ channel: 'sales', kind: 'sale', id: 's' }))).toBeNull()
    expect(forwardFor(rep, all, ev({ channel: 'sales', kind: 'sale', id: 's', repId: 'r1' }))).toEqual({ channel: 'sales', kind: 'sale', id: 's' })
    expect(forwardFor(rep, all, ev({ channel: 'stock', kind: 'move', warehouseId: 'w2' }))).toBeNull()
    expect(forwardFor(rep, all, ev({ channel: 'stock', kind: 'recost', warehouseId: 'main' }))).toBeNull()
    expect(forwardFor(rep, all, ev({ channel: 'stock', kind: 'move', warehouseId: 'main' }))).toEqual({ channel: 'stock', kind: 'move', warehouseId: 'main' })
    expect(forwardFor(rep, all, ev({ channel: 'rates', kind: 'rate', date: '2026-11-04' }))).toEqual({ channel: 'rates', kind: 'rate', date: '2026-11-04' })
    expect(forwardFor(rep, all, ev({ channel: 'dashboard', kind: 'purchase', id: 'p' }))).toBeNull()
    expect(forwardFor(owner, new Set(['rates'] as const), ev({ channel: 'sales', kind: 'sale', id: 's' }))).toBeNull()
  })

  it('parses channels= against the whitelist', () => {
    expect(parseChannels(null)).toEqual(all)
    expect(parseChannels('stock,rates')).toEqual(new Set(['stock', 'rates']))
    for (const bad of ['', 'stock,', 'costs', 'stock;DROP', 'STOCK']) expect(parseChannels(bad), bad).toBeNull()
  })
})
