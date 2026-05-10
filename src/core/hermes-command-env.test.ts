import { delimiter } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildHermesCommandEnv } from './hermes-command-env'

describe('Hermes command env', () => {
  test('injects Hermes control variables and prepends the stoa-ctl bin dir to PATH', () => {
    const env = buildHermesCommandEnv({
      sessionId: 'hermes_1',
      sessionSecret: 'secret-1',
      webhookPort: 43127,
      stoaCtlBinDir: 'D:/Users/test/AppData/Roaming/Stoa/bin',
      basePath: `C:/Windows/System32${delimiter}C:/Tools`
    })

    expect(env).toMatchObject({
      STOA_HERMES: '1',
      STOA_HERMES_SESSION_ID: 'hermes_1',
      STOA_SESSION_ID: 'hermes_1',
      STOA_CTL_BASE_URL: 'http://127.0.0.1:43127',
      STOA_CTL_TOKEN: 'secret-1'
    })
    expect(env.PATH).toBe(`D:/Users/test/AppData/Roaming/Stoa/bin${delimiter}C:/Windows/System32${delimiter}C:/Tools`)
    expect(env.STOA_CTL_COMMAND).toContain('stoa-ctl')
  })
})
