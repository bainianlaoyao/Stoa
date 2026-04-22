import { describe, expect, test } from 'vitest'
import { createOpenCodeProvider } from './opencode-provider'

describe('opencode provider', () => {
  test('builds a fresh start command with a predictable server port', async () => {
    const provider = createOpenCodeProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_demo_001',
      project_id: 'project_demo',
      path: 'D:/demo',
      title: 'demo',
      type: 'opencode'
    }, {
      webhookPort: 43127,
      sessionSecret: 'secret-1',
      providerPort: 43128
    })

    expect(command.command).toBe(process.platform === 'win32' ? 'opencode.cmd' : 'opencode')
    expect(command.args).toContain('--port')
    expect(command.args).toContain('43128')
    expect(command.cwd).toBe('D:/demo')
    expect(command.env.STOA_SESSION_ID).toBe('session_demo_001')
    expect(command.env.STOA_SESSION_SECRET).toBe('secret-1')
  })

  test('builds a resume command from canonical external session id', async () => {
    const provider = createOpenCodeProvider()

    const command = await provider.buildResumeCommand({
      session_id: 'session_op_1',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Deploy',
      type: 'opencode'
    }, 'external-123', {
      webhookPort: 4100,
      sessionSecret: 'secret',
      providerPort: 4101
    })

    expect(command.command).toBe(process.platform === 'win32' ? 'opencode.cmd' : 'opencode')
    expect(command.args).toContain('--session')
    expect(command.args).toContain('external-123')
  })
})
