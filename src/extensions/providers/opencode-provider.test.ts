import { describe, expect, test } from 'vitest'
import { createOpenCodeProvider } from './opencode-provider'

describe('opencode provider', () => {
  test('builds a fresh start command with a predictable server port', async () => {
    const provider = createOpenCodeProvider()

    const command = await provider.buildStartCommand({
      workspace_id: 'ws_demo_001',
      path: 'D:/demo',
      name: 'demo',
      provider_id: 'opencode',
      last_cli_session_id: null,
      last_known_status: 'bootstrapping',
      updated_at: '2026-04-18T10:00:00.000Z'
    }, {
      webhookPort: 43127,
      workspaceSecret: 'secret-1',
      providerPort: 43128
    })

    expect(command.command).toBe('opencode')
    expect(command.args).toContain('--port')
    expect(command.args).toContain('43128')
    expect(command.cwd).toBe('D:/demo')
    expect(command.env.VIBECODING_WORKSPACE_ID).toBe('ws_demo_001')
    expect(command.env.VIBECODING_WORKSPACE_SECRET).toBe('secret-1')
  })

  test('builds a resume command that targets the saved cli session id', async () => {
    const provider = createOpenCodeProvider()

    const command = await provider.buildResumeCommand({
      workspace_id: 'ws_demo_001',
      path: 'D:/demo',
      name: 'demo',
      provider_id: 'opencode',
      last_cli_session_id: 'chat-xyz',
      last_known_status: 'running',
      updated_at: '2026-04-18T10:00:00.000Z'
    }, 'chat-xyz', {
      webhookPort: 43127,
      workspaceSecret: 'secret-1',
      providerPort: 43128
    })

    expect(command.command).toBe('opencode')
    expect(command.args).toContain('--session')
    expect(command.args).toContain('chat-xyz')
  })
})
