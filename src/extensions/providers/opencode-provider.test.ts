import { describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  test('sidecar sends raw hook events to /hooks/opencode with SDK client', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-opencode-sidecar-'))
    const provider = createOpenCodeProvider()

    try {
      await provider.installSidecar({
        session_id: 'session_demo_001',
        project_id: 'project_demo',
        path: workspaceDir,
        title: 'demo',
        type: 'opencode'
      }, {
        webhookPort: 43127,
        sessionSecret: 'secret-1',
        providerPort: 43128
      })

      const content = await readFile(join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts'), 'utf8')
      const manifest = JSON.parse(await readFile(join(workspaceDir, '.opencode', '.stoa-managed-sidecar.json'), 'utf8')) as {
        artifactPaths: string[]
      }
      expect(content).toContain('/hooks/opencode')
      expect(content).toContain('hook_event_name: event.type')
      expect(content).toContain('session_id: event.properties?.sessionID')
      expect(content).toContain('turn_id: event.properties?.messageID')
      expect(content).toContain('tool_name: event.properties?.toolName')
      expect(content).toContain('provider_session_id: event.properties?.sessionID')
      expect(content).toContain('async ({ client }) => ({')
      expect(content).toContain('enrichWithMessages(client, event, body)')
      expect(content).toContain('client.session.messages')
      expect(content).toContain("'tool.execute.before'")
      expect(content).toContain("'tool.execute.after'")
      expect(content).toContain("'session.created'")
      expect(content).toContain("'session.idle'")
      expect(content).toContain("'session.error'")
      expect(content).toContain("'message.updated'")
      expect(content).toContain("'permission.asked'")
      expect(content).toContain("'permission.replied'")
      expect(content).toContain("'x-stoa-session-id': sessionId")
      expect(content).toContain("'x-stoa-project-id': projectId")
      expect(content).toContain("'x-stoa-secret': sessionSecret")
      expect(content).toContain('toFailureReason(event)')
      expect(content).not.toContain('event_version:')
      expect(content).not.toContain('event_id:')
      expect(content).not.toContain('event_type:')
      expect(content).not.toContain('source: ')
      expect(content).not.toContain('payload:')
      expect(content).not.toContain('intent:')
      expect(content).not.toContain('agentState:')
      expect(content).not.toContain('hasUnseenCompletion:')
      expect(manifest.artifactPaths).toEqual([join('.opencode', 'plugins', 'stoa-status.ts')])
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})
