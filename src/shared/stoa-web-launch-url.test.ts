import { describe, expect, it } from 'vitest'
import { buildStoaWebLaunchUrl, readStoaWebTokenFromHash } from './stoa-web-launch-url'

describe('stoa web launch url helpers', () => {
  it('builds a fragment-based launch url with an encoded token', () => {
    expect(buildStoaWebLaunchUrl('http://127.0.0.1:3270', 'token with spaces/+?')).toBe(
      'http://127.0.0.1:3270/#token=token+with+spaces%2F%2B%3F'
    )
  })

  it('reads the token from a fragment payload', () => {
    expect(readStoaWebTokenFromHash('#token=test-token')).toBe('test-token')
    expect(readStoaWebTokenFromHash('token=encoded%2Fvalue')).toBe('encoded/value')
  })

  it('returns null when the fragment does not contain a token', () => {
    expect(readStoaWebTokenFromHash('')).toBeNull()
    expect(readStoaWebTokenFromHash('#foo=bar')).toBeNull()
  })
})
