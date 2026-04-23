import { describe, expect, test } from 'vitest'
import { createClaudeCodeProvider } from './claude-code-provider'

describe('claude-code provider', () => {
  test('builds a start command with seeded session id', async () => {
    const provider = createClaudeCodeProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_claude_1',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Claude Alpha',
      type: 'claude-code',
      external_session_id: 'external-123'
    }, {
      webhookPort: 43127,
      sessionSecret: 'secret',
      providerPort: 43128
    })

    expect(command.command).toBe('claude')
    expect(command.args).toEqual(['--session-id', 'external-123'])
    expect(command.cwd).toBe('D:/alpha')
  })

  test('appends dangerously-skip-permissions on fresh start when enabled', async () => {
    const provider = createClaudeCodeProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_claude_2',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Claude Alpha',
      type: 'claude-code',
      external_session_id: 'external-456'
    }, {
      webhookPort: 43127,
      sessionSecret: 'secret',
      providerPort: 43128,
      claudeDangerouslySkipPermissions: true
    })

    expect(command.args).toEqual(['--session-id', 'external-456', '--dangerously-skip-permissions'])
  })

  test('appends dangerously-skip-permissions on resume when enabled', async () => {
    const provider = createClaudeCodeProvider()

    const command = await provider.buildResumeCommand({
      session_id: 'session_claude_3',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Claude Alpha',
      type: 'claude-code',
      external_session_id: 'external-789'
    }, 'external-789', {
      webhookPort: 43127,
      sessionSecret: 'secret',
      providerPort: 43128,
      claudeDangerouslySkipPermissions: true
    })

    expect(command.args).toEqual(['--resume', 'external-789', '--dangerously-skip-permissions'])
  })

  test('uses configured provider path when provided in context', async () => {
    const provider = createClaudeCodeProvider()

    const command = await provider.buildStartCommand({
      session_id: 'session_claude_4',
      project_id: 'project_alpha',
      path: 'D:/alpha',
      title: 'Claude Alpha',
      type: 'claude-code',
      external_session_id: 'external-012'
    }, {
      webhookPort: 43127,
      sessionSecret: 'secret',
      providerPort: 43128,
      providerPath: 'C:\\Users\\30280\\AppData\\Roaming\\npm\\claude.cmd'
    })

    expect(command.command).toBe('C:\\Users\\30280\\AppData\\Roaming\\npm\\claude.cmd')
  })
})
