import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import type { CanonicalSessionEvent, SessionStatus } from '@shared/project-session'
import {
  cleanupStateDir,
  getMainE2EDebugState,
  launchElectronApp,
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
      const projectRow = await createProject(app.page, {
        name: 'webhook-session-project',
        path: join(app.stateDir, 'webhook-session-project')
      })
      const sessionRow = await createSession(app.page, projectRow, {
        title: 'OpenCode Events 1',
        type: 'opencode'
      })

      const debugState = await getMainE2EDebugState(app.electronApp)
      const session = debugState?.snapshot?.sessions.find(candidate => candidate.title === 'OpenCode Events 1')
      const secret = session ? debugState?.sessionSecrets[session.id] : undefined

      expect(debugState?.webhookPort).toBeTruthy()
      expect(session).toBeDefined()
      expect(secret).toBeTruthy()

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        event: createCanonicalEvent({
          sessionId: session!.id,
          projectId: session!.projectId,
          status: 'awaiting_input',
          summary: 'session.idle'
        })
      })

      expect(response.status).toBe(202)
      await expect(sessionRow.locator('.route-dot.awaiting_input')).toBeVisible()
      await expect(app.page.getByRole('region', { name: 'Session details' })).toContainText('awaiting_input')
      await expect(app.page.getByRole('region', { name: 'Session details' })).toContainText('session.idle')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('webhook-driven UI update', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app.page, {
        name: 'webhook-status-project',
        path: join(app.stateDir, 'webhook-status-project')
      })
      const sessionRow = await createSession(app.page, projectRow, {
        title: 'OpenCode Webhook 1',
        type: 'opencode'
      })

      const debugState = await getMainE2EDebugState(app.electronApp)
      const session = debugState?.snapshot?.sessions.find(candidate => candidate.title === 'OpenCode Webhook 1')
      const secret = session ? debugState?.sessionSecrets[session.id] : undefined

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: secret!,
        event: createCanonicalEvent({
          sessionId: session!.id,
          projectId: session!.projectId,
          status: 'exited',
          summary: 'session.completed'
        })
      })

      expect(response.status).toBe(202)
      await expect(sessionRow.locator('.route-dot.exited')).toBeVisible()
      await expect(app.page.getByRole('region', { name: 'Session details' })).toContainText('exited')
      await expect(app.page.getByRole('region', { name: 'Session details' })).toContainText('session.completed')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('invalid webhook secret does not update UI', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app.page, {
        name: 'invalid-webhook-project',
        path: join(app.stateDir, 'invalid-webhook-project')
      })
      const sessionRow = await createSession(app.page, projectRow, {
        title: 'OpenCode Invalid Secret 1',
        type: 'opencode'
      })

      const debugState = await getMainE2EDebugState(app.electronApp)
      const session = debugState?.snapshot?.sessions.find(candidate => candidate.title === 'OpenCode Invalid Secret 1')
      const details = app.page.getByRole('region', { name: 'Session details' })

      expect(session).toBeDefined()
      const detailsBefore = (await details.textContent()) ?? ''
      const statusClassBefore = await sessionRow.locator('.route-dot').evaluate((element) => element.className)

      const response = await postWebhookEvent({
        port: debugState!.webhookPort!,
        secret: 'invalid-secret',
        event: createCanonicalEvent({
          sessionId: session!.id,
          projectId: session!.projectId,
          status: 'awaiting_input',
          summary: 'should-not-apply'
        })
      })

      expect(response.status).toBe(401)
      await expect(sessionRow.locator('.route-dot')).toHaveClass(statusClassBefore)
      await expect(details).not.toContainText('should-not-apply')
      await expect(details).toHaveText(detailsBefore)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
