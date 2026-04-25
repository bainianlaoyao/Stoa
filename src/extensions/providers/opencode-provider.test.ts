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

  test('sidecar emits intentful state patch payloads', async () => {
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
      expect(content).toContain("intent: 'agent.permission_requested'")
      expect(content).toContain("intent: 'agent.permission_resolved'")
      expect(content).toContain("intent: 'agent.turn_completed'")
      expect(content).toContain("intent: 'agent.turn_failed'")
      expect(content).toContain("agentState: denied ? (failed ? 'error' : 'idle') : 'working'")
      expect(content).toContain('hasUnseenCompletion: true')
      expect(content).toContain("'x-stoa-secret': sessionSecret")
      expect(content).toContain('session_id: sessionId')
      expect(content).toContain('project_id: projectId')
      expect(content).not.toContain("'x-stoa-secret': process.env.STOA_SESSION_SECRET")
      expect(content).not.toContain('session_id: process.env.STOA_SESSION_ID')
      expect(content).not.toContain('project_id: process.env.STOA_PROJECT_ID')
      expect(content).not.toContain("status = 'running'")
      expect(content).not.toContain("status = 'turn_complete'")
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})
