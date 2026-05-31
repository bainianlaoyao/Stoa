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
      basePath: `C:/System32${delimiter}C:/Tools`
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
      stoaCtlBinDir: '/usr/local/bin'
    })

    expect(env).not.toHaveProperty('STOA_META_SESSION')
    expect(env).not.toHaveProperty('STOA_META_SESSION_ID')
  })

  test('falls back to process.env.PATH when basePath is omitted', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's2',
      sessionToken: 'tok_2',
      webhookPort: 8080,
      stoaCtlBinDir: '/bin'
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
      basePath: ''
    })

    expect(env.PATH).toBe('/stoa-bin')
  })

  test('treats null basePath like omission and still prepends the bin dir', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's4',
      sessionToken: 'tok_4',
      webhookPort: 8080,
      stoaCtlBinDir: '/stoa-bin',
      basePath: null
    })

    expect(env.PATH).toContain('/stoa-bin')
  })
})
