import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import type { CanonicalSessionEvent, SessionStatus } from '@shared/project-session'
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
  status: SessionStatus
  summary: string
}): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: `evt_${randomUUID()}`,
    event_type: args.status === 'exited' ? 'session.completed' : 'session.status_changed',
    timestamp: new Date().toISOString(),
    session_id: args.sessionId,
    project_id: args.projectId,
    source: 'hook-sidecar',
    payload: {
      status: args.status,
      summary: args.summary,
      isProvisional: false
    }
  }
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

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      const secret = sessionState ? debugState?.sessionSecrets[sessionState.id] : undefined

      expect(debugState?.webhookPort).toBeTruthy()
      expect(sessionState).toBeDefined()
      expect(secret).toBeTruthy()

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        event: createCanonicalEvent({
          sessionId: sessionState!.id,
          projectId: sessionState!.projectId,
          status: 'awaiting_input',
          summary: 'session.idle'
        })
      })

      expect(response.status).toBe(202)
      await expect(session.row.locator('[data-testid="session-status-dot"][data-status="awaiting_input"]')).toBeVisible()

      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toMatchObject({
        status: 'awaiting_input',
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

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      const secret = sessionState ? debugState?.sessionSecrets[sessionState.id] : undefined

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        event: createCanonicalEvent({
          sessionId: sessionState!.id,
          projectId: sessionState!.projectId,
          status: 'exited',
          summary: 'session.completed'
        })
      })

      expect(response.status).toBe(202)
      await expect(session.row.locator('[data-testid="session-status-dot"][data-status="exited"]')).toBeVisible()

      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toMatchObject({
        status: 'exited',
        summary: 'session.completed'
      })
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('turn_complete webhook projection', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'turn-complete-project',
        path: join(app.stateDir, 'turn-complete-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'codex'
      })

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      const secret = sessionState ? debugState?.sessionSecrets[sessionState.id] : undefined

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        event: createCanonicalEvent({
          sessionId: sessionState!.id,
          projectId: sessionState!.projectId,
          status: 'turn_complete',
          summary: 'Turn complete'
        })
      })

      expect(response.status).toBe(202)
      await expect(session.row.locator('[data-testid="session-status-dot"][data-status="turn_complete"]')).toBeVisible()

      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toMatchObject({
        status: 'turn_complete',
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

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
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
      await expect(session.row.locator('[data-testid="session-status-dot"][data-status="turn_complete"]')).toBeVisible()

      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toMatchObject({
        status: 'turn_complete',
        summary: 'Stop'
      })
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

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
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
      await expect(session.row.locator('[data-testid="session-status-dot"][data-status="needs_confirmation"]')).toBeVisible()

      const terminalViewport = app.page.getByTestId('terminal-viewport')
      await expect(terminalViewport.getByTestId('terminal-xterm')).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-status-bar')).toBeVisible()

      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toMatchObject({
        status: 'needs_confirmation',
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

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find(candidate => candidate.title === session.title)
      expect(sessionState).toBeDefined()
      const sessionBefore = await getMainE2EDebugState(app.electronApp)
      const statusBefore = await session.row.locator('[data-testid="session-status-dot"]').getAttribute('data-status')

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: 'invalid-secret',
        event: createCanonicalEvent({
          sessionId: sessionState!.id,
          projectId: sessionState!.projectId,
          status: 'awaiting_input',
          summary: 'should-not-apply'
        })
      })

      expect(response.status).toBe(401)
      await expect(session.row.locator('[data-testid="session-status-dot"]')).toHaveAttribute('data-status', statusBefore!)
      await expect.poll(async () => {
        const nextDebugState = await getMainE2EDebugState(app.electronApp)
        return nextDebugState?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null
      }).toEqual(sessionBefore?.snapshot?.sessions.find(candidate => candidate.id === sessionState!.id) ?? null)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
