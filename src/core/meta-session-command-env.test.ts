import { delimiter } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildMetaSessionCommandEnv } from './meta-session-command-env'

describe('meta-session command env', () => {
  test('injects meta-session control variables and prepends the stoa-ctl bin dir to PATH', () => {
    const env = buildMetaSessionCommandEnv({
      sessionId: 'meta_session_1',
      webhookPort: 43127,
      stoaCtlBinDir: 'D:/Users/test/AppData/Roaming/Stoa/bin',
      basePath: `C:/Windows/System32${delimiter}C:/Tools`
    })

    expect(env).toMatchObject({
      STOA_META_SESSION: '1',
      STOA_META_SESSION_ID: 'meta_session_1',
      STOA_SESSION_ID: 'meta_session_1',
      STOA_CTL_BASE_URL: 'http://127.0.0.1:43127'
    })
    expect(env.PATH).toBe(`D:/Users/test/AppData/Roaming/Stoa/bin${delimiter}C:/Windows/System32${delimiter}C:/Tools`)
    expect(env.STOA_CTL_COMMAND).toContain('stoa-ctl')
  })
})
