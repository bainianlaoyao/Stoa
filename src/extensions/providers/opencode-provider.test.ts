import { describe, expect, test } from 'vitest'
import { createOpenCodeProvider } from './opencode-provider'

describe('opencode provider', () => {
  test('builds a fresh start command in pure tui mode', async () => {
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

    expect(command.command).toBe('opencode')
    expect(command.args).toEqual([])
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

    expect(command.command).toBe('opencode')
    expect(command.args).toEqual(['--session', 'external-123'])
  })

  test('uses configured provider path when provided in context', async () => {
    const provider = createOpenCodeProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_op_1',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Deploy',
      type: 'opencode'
    }, {
      webhookPort: 4100,
      sessionSecret: 'secret',
      providerPort: 4101,
      providerPath: 'C:\\Users\\30280\\AppData\\Roaming\\npm\\opencode.ps1'
    })

    expect(command.command).toBe('C:\\Users\\30280\\AppData\\Roaming\\npm\\opencode.ps1')
    expect(command.args).toEqual([])
  })
})
