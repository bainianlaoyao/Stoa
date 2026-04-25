import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import type { CanonicalSessionEvent, SessionStatePatchPayload } from '@shared/project-session'
import {
  cleanupStateDir,
  getMainE2EDebugState,
  launchElectronApp,
  postClaudeHookEvent,
  postWebhookEvent
} from './fixtures/electron-app'
import { createProject, createSession } from './helpers/ui-actions'

function createCanonicalEvent(args: {
  sessionId: string
  projectId: string
  eventType: string
  payload: SessionStatePatchPayload
}): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: `evt_${randomUUID()}`,
    event_type: args.eventType,
    timestamp: new Date().toISOString(),
    session_id: args.sessionId,
    project_id: args.projectId,
    source: 'hook-sidecar',
    payload: args.payload
  }
}

async function waitForSessionSnapshot(app: Parameters<typeof getMainE2EDebugState>[0], sessionId: string) {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const nextDebugState = await getMainE2EDebugState(app)
    const session = nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionId) ?? null
    if (session) {
      return session
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for session snapshot ${sessionId}`)
}

async function waitForSessionState(
  app: Parameters<typeof getMainE2EDebugState>[0],
  sessionId: string,
  predicate: (
    session: {
      runtimeState?: string
      agentState?: string
      hasUnseenCompletion?: boolean
      runtimeExitReason?: string | null
    }
  ) => boolean
) {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const nextDebugState = await getMainE2EDebugState(app)
    const session = nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionId) ?? null
    if (session && predicate(session)) {
      return session
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for session ${sessionId} state predicate`)
}

test.describe('Electron push and webhook journeys', () => {
  test('session event projection', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'webhook-session-project',
        path: join(app.stateDir, 'webhook-session-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'opencode'
      })

      const initialDebugState = await getMainE2EDebugState(app.electronApp)
      const initialSessionState = initialDebugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      expect(initialDebugState?.webhookPort).toBeTruthy()
      expect(initialSessionState).toBeDefined()

      await waitForSessionState(app.electronApp, initialSessionState!.id, candidate => candidate.runtimeState === 'alive')

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.id === initialSessionState!.id)
      const secret = sessionState ? debugState?.sessionSecrets[sessionState.id] : undefined
      expect(secret).toBeTruthy()

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        event: createCanonicalEvent({
          sessionId: sessionState!.id,
          projectId: sessionState!.projectId,
          eventType: 'session.completed',
          payload: {
            intent: 'agent.turn_completed',
            agentState: 'idle',
            hasUnseenCompletion: true,
            summary: 'session.idle'
          }
        })
      })

      expect(response.status).toBe(202)
      await expect(session.row.locator('[data-testid="session-status-dot"]')).toHaveAttribute(
        'data-session-status-testid',
        'session-status-complete'
      )

      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toMatchObject({
        runtimeState: 'alive',
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'session.idle'
      })
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('webhook-driven UI update', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'webhook-status-project',
        path: join(app.stateDir, 'webhook-status-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'opencode'
      })

      const initialDebugState = await getMainE2EDebugState(app.electronApp)
      const initialSessionState = initialDebugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      expect(initialSessionState).toBeDefined()
      await waitForSessionState(app.electronApp, initialSessionState!.id, candidate => candidate.runtimeState === 'alive')

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.id === initialSessionState!.id)
      const secret = sessionState ? debugState?.sessionSecrets[sessionState.id] : undefined

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        event: createCanonicalEvent({
          sessionId: sessionState!.id,
          projectId: sessionState!.projectId,
          eventType: 'session.completed',
          payload: {
            intent: 'runtime.exited_clean',
            runtimeState: 'exited',
            runtimeExitCode: 0,
            runtimeExitReason: 'clean',
            summary: 'session.completed'
          }
        })
      })

      expect(response.status).toBe(202)
      await expect(session.row.locator('[data-testid="session-status-dot"]')).toHaveAttribute(
        'data-session-status-testid',
        'session-status-exited'
      )

      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toMatchObject({
        runtimeState: 'exited',
        runtimeExitReason: 'clean',
        summary: 'session.completed'
      })
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('completion webhook projection', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'turn-complete-project',
        path: join(app.stateDir, 'turn-complete-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'codex'
      })

      const initialDebugState = await getMainE2EDebugState(app.electronApp)
      const initialSessionState = initialDebugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      expect(initialSessionState).toBeDefined()
      await waitForSessionState(app.electronApp, initialSessionState!.id, candidate => candidate.runtimeState === 'alive')

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.id === initialSessionState!.id)
      const secret = sessionState ? debugState?.sessionSecrets[sessionState.id] : undefined

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        event: createCanonicalEvent({
          sessionId: sessionState!.id,
          projectId: sessionState!.projectId,
          eventType: 'session.completed',
          payload: {
            intent: 'agent.turn_completed',
            agentState: 'idle',
            hasUnseenCompletion: true,
            summary: 'Turn complete'
          }
        })
      })

      expect(response.status).toBe(202)
      await expect(session.row.locator('[data-testid="session-status-dot"]')).toHaveAttribute(
        'data-session-status-testid',
        'session-status-complete'
      )

      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toMatchObject({
        runtimeState: 'alive',
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Turn complete'
      })
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('claude Stop hook updates UI through the raw hook route', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'claude-hook-project',
        path: join(app.stateDir, 'claude-hook-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'claude-code'
      })

      const initialDebugState = await getMainE2EDebugState(app.electronApp)
      const initialSessionState = initialDebugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      expect(initialSessionState).toBeDefined()
      await waitForSessionState(app.electronApp, initialSessionState!.id, candidate => candidate.runtimeState === 'alive')

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.id === initialSessionState!.id)
      const secret = sessionState ? debugState?.sessionSecrets[sessionState.id] : undefined

      const response = await postClaudeHookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        sessionId: sessionState!.id,
        projectId: sessionState!.projectId,
        body: {
          hook_event_name: 'Stop'
        }
      })

      expect(response.status).toBe(202)
      await expect(session.row.locator('[data-testid="session-status-dot"]')).toHaveAttribute(
        'data-session-status-testid',
        'session-status-complete'
      )

      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toMatchObject({
        runtimeState: 'alive',
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Stop'
      })
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('claude activity hook moves a ready session back to running', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'claude-activity-project',
        path: join(app.stateDir, 'claude-activity-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'claude-code'
      })

      const initialDebugState = await getMainE2EDebugState(app.electronApp)
      const initialSessionState = initialDebugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      expect(initialSessionState).toBeDefined()
      await waitForSessionState(app.electronApp, initialSessionState!.id, candidate => candidate.runtimeState === 'alive')

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.id === initialSessionState!.id)
      const secret = sessionState ? debugState?.sessionSecrets[sessionState.id] : undefined

      const statusDot = session.row.locator('[data-testid="session-status-dot"]')
      await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-ready')

      const stopResponse = await postClaudeHookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        sessionId: sessionState!.id,
        projectId: sessionState!.projectId,
        body: {
          hook_event_name: 'Stop'
        }
      })

      expect(stopResponse.status).toBe(202)
      await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-complete')
      await session.row.click()
      await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-ready')

      const activityResponse = await postClaudeHookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        sessionId: sessionState!.id,
        projectId: sessionState!.projectId,
        body: {
          hook_event_name: 'UserPromptSubmit'
        }
      })

      expect(activityResponse.status).toBe(202)
      await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-running')
      await expect(statusDot).toHaveAttribute('data-phase', 'running')
      await expect(statusDot).toHaveAttribute('data-tone', 'success')
      await expect(session.row.locator('.route-session-label')).toContainText('Running')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('claude PermissionRequest hook keeps the terminal mounted', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'claude-permission-project',
        path: join(app.stateDir, 'claude-permission-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'claude-code'
      })

      const initialDebugState = await getMainE2EDebugState(app.electronApp)
      const initialSessionState = initialDebugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      expect(initialSessionState).toBeDefined()
      await waitForSessionState(app.electronApp, initialSessionState!.id, candidate => candidate.runtimeState === 'alive')

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.id === initialSessionState!.id)
      const secret = sessionState ? debugState?.sessionSecrets[sessionState.id] : undefined

      const response = await postClaudeHookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        sessionId: sessionState!.id,
        projectId: sessionState!.projectId,
        body: {
          hook_event_name: 'PermissionRequest'
        }
      })

      expect(response.status).toBe(202)
      const statusDot = session.row.locator('[data-testid="session-status-dot"]')
      await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-blocked')
      await expect(statusDot).toHaveAttribute('data-phase', 'blocked')
      await expect(statusDot).toHaveAttribute('data-tone', 'warning')
      await expect(app.page.getByTestId('terminal-status-bar')).toHaveCount(0)

      const terminalViewport = app.page.getByTestId('terminal-viewport')
      await expect(terminalViewport.getByTestId('terminal-xterm')).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-xterm-mount')).toBeVisible()

      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toMatchObject({
        runtimeState: 'alive',
        agentState: 'blocked',
        summary: 'PermissionRequest'
      })
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('invalid webhook secret does not update UI', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'invalid-webhook-project',
        path: join(app.stateDir, 'invalid-webhook-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'opencode'
      })

      const initialDebugState = await getMainE2EDebugState(app.electronApp)
      const initialSessionState = initialDebugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      expect(initialSessionState).toBeDefined()
      await waitForSessionState(app.electronApp, initialSessionState!.id, candidate => candidate.runtimeState === 'alive')

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.id === initialSessionState!.id)
      expect(sessionState).toBeDefined()
      const sessionBefore = await waitForSessionSnapshot(app.electronApp, sessionState!.id)
      const statusDot = session.row.locator('[data-testid="session-status-dot"]')
      const statusBefore = await statusDot.getAttribute('data-session-status-testid')
      expect(statusBefore).toBeTruthy()

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: 'invalid-secret',
        event: createCanonicalEvent({
          sessionId: sessionState!.id,
          projectId: sessionState!.projectId,
          eventType: 'session.completed',
          payload: {
            intent: 'agent.turn_completed',
            agentState: 'idle',
            hasUnseenCompletion: true,
            summary: 'should-not-apply'
          }
        })
      })

      expect(response.status).toBe(401)
      await expect(statusDot).toHaveAttribute('data-session-status-testid', statusBefore!)
      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toEqual(sessionBefore)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
