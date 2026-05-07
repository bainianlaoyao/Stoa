import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LinkCache } from './link-cache'

describe('LinkCache', () => {
  let cache: LinkCache

  beforeEach(() => {
    vi.useFakeTimers()
    cache = new LinkCache(5000)
  })

  test('stores and retrieves values', () => {
    const entry = { path: '/foo/bar.ts', exists: true }
    cache.set('key1', entry)
    expect(cache.get('key1')).toEqual(entry)
  })

  test('returns undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined()
  })

  test('expires entries after TTL', () => {
    cache.set('key1', { path: '/a.ts', exists: true })
    vi.advanceTimersByTime(4999)
    expect(cache.get('key1')).toEqual({ path: '/a.ts', exists: true })
    vi.advanceTimersByTime(1)
    expect(cache.get('key1')).toBeUndefined()
  })

  test('TTL resets on any set call', () => {
    cache.set('key1', { path: '/a.ts', exists: true })
    vi.advanceTimersByTime(3000)
    cache.set('key2', { path: '/b.ts', exists: false })
    vi.advanceTimersByTime(3000)
    // Only 3s since last set (TTL=5s), both should still exist
    expect(cache.get('key1')).toEqual({ path: '/a.ts', exists: true })
    expect(cache.get('key2')).toEqual({ path: '/b.ts', exists: false })
    // Advance past TTL from last set
    vi.advanceTimersByTime(2000)
    expect(cache.get('key1')).toBeUndefined()
    expect(cache.get('key2')).toBeUndefined()
  })

  test('clear() removes all entries', () => {
    cache.set('a', { path: '/a.ts', exists: true })
    cache.set('b', { path: '/b.ts', exists: false })
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })
})
