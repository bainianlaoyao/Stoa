// AUTO-GENERATED FILE. DO NOT EDIT.
import { randomUUID } from 'node:crypto'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'
import {
  cleanupStateDir,
  getMainE2EDebugState,
  launchElectronApp,
  postClaudeHookEvent,
  postWebhookEvent
} from '../../e2e-playwright/fixtures/electron-app'
import { createProject, createSession } from '../../e2e-playwright/helpers/ui-actions'

export const meta = defineGeneratedTestMeta({
  id: 'journey.session.telemetry.claude-lifecycle',
  behaviorIds: [
    'session.presence.ready',
    'session.presence.running',
    'session.presence.blocked',
    'session.presence.complete',
    'session.presence.failed'
  ],
  entities: ['project', 'session', 'provider-telemetry', 'renderer-status'],
  statesCovered: [
    'presence.ready',
    'presence.running',
    'presence.blocked',
    'presence.complete',
    'presence.failed'
  ],
  interruptionsCovered: [
    'runtime.alive.withoutAgentTelemetry',
    'provider.permissionRequest.duringRunning',
    'user.visitsCompletedSession',
    'provider.permissionResolved',
    'runtime.exitedFailed.afterCompletion'
  ],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state', 'persisted-state'],
  riskBudget: 'critical',
  regressionSources: ['claude.raw-hook', 'session-state-reducer']
})

async function installFakeClaude(app: Awaited<ReturnType<typeof launchElectronApp>>): Promise<void> {
  const fakeClaudePath = join(app.stateDir, process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.sh')
  const script = process.platform === 'win32'
    ? '@echo off\r\nping -n 30 127.0.0.1 >nul\r\n'
    : '#!/bin/sh\nsleep 30\n'

  await writeFile(fakeClaudePath, script, 'utf8')
  if (process.platform !== 'win32') {
    await chmod(fakeClaudePath, 0o755)
  }

  await app.page.evaluate(async (providerPath) => {
    const api = (window as typeof window & {
      stoa?: { setSetting?: (key: string, value: unknown) => Promise<void> }
    }).stoa
    await api?.setSetting?.('providers', { 'claude-code': providerPath })
  }, fakeClaudePath)
}

async function waitForSessionState(
  app: Awaited<ReturnType<typeof launchElectronApp>>,
  title: string,
  predicate: (session: { runtimeState?: string; agentState?: string }) => boolean
) {
  await expect.poll(async () => {
    const debugState = await getMainE2EDebugState(app.electronApp)
    const session = debugState?.snapshot?.sessions.find(candidate => candidate.title === title) ?? null
    return session && predicate(session) ? session : null
  }, { timeout: 15_000 }).not.toBeNull()

  const debugState = await getMainE2EDebugState(app.electronApp)
  const session = debugState?.snapshot?.sessions.find(candidate => candidate.title === title)
  if (!session) {
    throw new Error(`Unable to find session ${title}`)
  }
  return session
}

test('journey.session.telemetry.claude-lifecycle', async () => {
  const app = await launchElectronApp()

  try {
    await installFakeClaude(app)
    const projectRow = await createProject(app, {
      name: 'generated-claude-lifecycle-project',
      path: join(app.stateDir, 'generated-claude-lifecycle-project')
    })

    const session = await createSession(app.page, projectRow, {
      type: 'claude-code'
    })

    const sessionState = await waitForSessionState(
      app,
      session.title,
      candidate => candidate.runtimeState === 'alive'
    )
    const debugState = await getMainE2EDebugState(app.electronApp)
    const secret = debugState?.sessionSecrets[sessionState.id]
    expect(secret).toBeTruthy()

    const statusDot = session.row.locator('[data-testid="session-status-dot"]')
    await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-ready')
    await expect(statusDot).toHaveAttribute('data-tone', 'neutral')

    await expect((await postClaudeHookEvent({
      port: debugState!.webhookPort!,
      secret: secret!,
      sessionId: sessionState.id,
      projectId: sessionState.projectId,
      body: { hook_event_name: 'UserPromptSubmit' }
    })).status).toBe(202)
    await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-running')

    await expect((await postClaudeHookEvent({
      port: debugState!.webhookPort!,
      secret: secret!,
      sessionId: sessionState.id,
      projectId: sessionState.projectId,
      body: { hook_event_name: 'PermissionRequest' }
    })).status).toBe(202)
    await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-blocked')

    await expect((await postWebhookEvent({
      port: debugState!.webhookPort!,
      secret: secret!,
      event: {
        event_version: 1,
        event_id: `evt_${randomUUID()}`,
        event_type: 'claude-code.PermissionResolved',
        timestamp: new Date().toISOString(),
        session_id: sessionState.id,
        project_id: sessionState.projectId,
        source: 'provider-adapter',
        payload: {
          intent: 'agent.permission_resolved',
          agentState: 'working',
          summary: 'Permission resolved'
        }
      }
    })).status).toBe(202)
    await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-running')

    await expect((await postClaudeHookEvent({
      port: debugState!.webhookPort!,
      secret: secret!,
      sessionId: sessionState.id,
      projectId: sessionState.projectId,
      body: { hook_event_name: 'Stop' }
    })).status).toBe(202)
    await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-complete')

    await session.row.click()
    await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-ready')

    await expect((await postWebhookEvent({
      port: debugState!.webhookPort!,
      secret: secret!,
      event: {
        event_version: 1,
        event_id: `evt_${randomUUID()}`,
        event_type: 'runtime.exited_failed',
        timestamp: new Date().toISOString(),
        session_id: sessionState.id,
        project_id: sessionState.projectId,
        source: 'provider-adapter',
        payload: {
          intent: 'runtime.exited_failed',
          runtimeState: 'exited',
          runtimeExitCode: 42,
          runtimeExitReason: 'failed',
          summary: 'Runtime failed'
        }
      }
    })).status).toBe(202)
    await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-failed')
  } finally {
    const { stateDir } = app
    await app.close()
    await cleanupStateDir(stateDir)
  }
})
