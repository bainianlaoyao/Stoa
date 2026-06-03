import { delimiter } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildSessionCommandEnv } from './session-command-env'

describe('session-command-env', () => {
  test('builds unified env with STOA_SESSION_ID, token, base URL, command, and PATH', () => {
    const env = buildSessionCommandEnv({
      sessionId: 'session-abc',
      sessionToken: 'tok_deadbeef',
      webhookPort: 43127,
      stoaCtlBinDir: 'D:/bin',
      basePath: `C:/System32${delimiter}C:/Tools`,
      stoaCtlEnabled: true
    })

    expect(env.STOA_SESSION_ID).toBe('session-abc')
    expect(env.STOA_CTL_SESSION_TOKEN).toBe('tok_deadbeef')
    expect(env.STOA_CTL_BASE_URL).toBe('http://127.0.0.1:43127')
    expect(env.STOA_CTL_COMMAND).toBe('stoa-ctl')
    expect(env.PATH).toBe(`D:/bin${delimiter}C:/System32${delimiter}C:/Tools`)
  })

  test('does NOT output STOA_META_SESSION or STOA_META_SESSION_ID', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's1',
      sessionToken: 'tok_1',
      webhookPort: 9999,
      stoaCtlBinDir: '/usr/local/bin',
      stoaCtlEnabled: true
    })

    expect(env).not.toHaveProperty('STOA_META_SESSION')
    expect(env).not.toHaveProperty('STOA_META_SESSION_ID')
  })

  test('falls back to process.env.PATH when basePath is omitted', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's2',
      sessionToken: 'tok_2',
      webhookPort: 8080,
      stoaCtlBinDir: '/bin',
      stoaCtlEnabled: true
    })

    expect(env.PATH).toContain('/bin')
    expect(env.PATH).toContain(delimiter)
  })

  test('prepends bin dir even when basePath is empty string', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's3',
      sessionToken: 'tok_3',
      webhookPort: 8080,
      stoaCtlBinDir: '/stoa-bin',
      basePath: '',
      stoaCtlEnabled: true
    })

    expect(env.PATH).toBe('/stoa-bin')
  })

  test('treats null basePath like omission and still prepends the bin dir', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's4',
      sessionToken: 'tok_4',
      webhookPort: 8080,
      stoaCtlBinDir: '/stoa-bin',
      basePath: null,
      stoaCtlEnabled: true
    })

    expect(env.PATH).toContain('/stoa-bin')
  })

  test('disabled omits STOA_CTL_COMMAND and does not prepend bin dir', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's-disabled',
      sessionToken: 'tok_disabled',
      webhookPort: 12345,
      stoaCtlBinDir: '/tmp/bin',
      stoaCtlEnabled: false
    })
    expect(env.STOA_CTL_COMMAND).toBeUndefined()
    expect(env.STOA_CTL_SESSION_TOKEN).toBeUndefined()
    expect(env.PATH.startsWith('/tmp/bin')).toBe(false)
  })

  test('disabled still emits STOA_CTL_BASE_URL and STOA_SESSION_ID for diagnostics', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's-diag',
      sessionToken: 'tok_diag',
      webhookPort: 12345,
      stoaCtlBinDir: '/tmp/bin',
      stoaCtlEnabled: false
    })
    expect(env.STOA_CTL_BASE_URL).toBe('http://127.0.0.1:12345')
    expect(env.STOA_SESSION_ID).toBe('s-diag')
  })
})
