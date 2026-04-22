import { afterEach, describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import { PtyHost } from '@core/pty-host'
import { readProjectSessions } from '@core/state-store'
import { startSessionRuntime } from '@core/session-runtime'
import type { SessionStatusEvent, TerminalDataChunk } from '@shared/project-session'
import { SessionRuntimeController } from '../../src/main/session-runtime-controller'
import {
  createMockWindow,
  createTestProvider,
  createTestGlobalStatePath,
  createTestWorkspace
} from './helpers'

interface PersistedEventState {
  pushedStatus: SessionStatusEvent['status']
  pushedSummary: string
  persistedStatus: SessionStatusEvent['status']
  persistedSummary: string
}

interface CompositionHarness {
  manager: ProjectSessionManager
  ptyHost: PtyHost
  sent: Array<{ channel: string; data: unknown }>
  session: {
    id: string
    projectId: string
    path: string
    title: string
    type: 'shell' | 'opencode'
    status: string
    externalSessionId: string | null
  }
  globalStatePath: string
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()

  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for composition seam lifecycle')
    }

    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

function getSessionEvents(sent: Array<{ channel: string; data: unknown }>): SessionStatusEvent[] {
  return sent
    .filter(entry => entry.channel === IPC_CHANNELS.sessionEvent)
    .map(entry => entry.data as SessionStatusEvent)
}

function getTerminalChunks(sent: Array<{ channel: string; data: unknown }>): TerminalDataChunk[] {
  return sent
    .filter(entry => entry.channel === IPC_CHANNELS.terminalData)
    .map(entry => entry.data as TerminalDataChunk)
}

async function createCompositionHarness(activeHosts: PtyHost[]): Promise<CompositionHarness> {
  const workspaceDir = await createTestWorkspace('vibecoding-e2e-composition-')
  const globalStatePath = await createTestGlobalStatePath()

  const manager = await ProjectSessionManager.create({
    webhookPort: null,
    globalStatePath
  })

  const project = await manager.createProject({
    path: workspaceDir,
    name: 'composition-seam-test'
  })

  const session = await manager.createSession({
    projectId: project.id,
    type: 'shell',
    title: 'Composition Shell'
  })

  const { window, sent } = createMockWindow()
  const controller = new SessionRuntimeController(manager, () => window)
  const ptyHost = new PtyHost()
  activeHosts.push(ptyHost)

  await startSessionRuntime({
    session: {
      id: session.id,
      projectId: session.projectId,
      path: workspaceDir,
      title: session.title,
      type: session.type,
      status: session.status,
      externalSessionId: session.externalSessionId
    },
    webhookPort: 43127,
    provider: createTestProvider('composition-seam-output'),
    ptyHost,
    manager: controller
  })

  return {
    manager,
    ptyHost,
    sent,
    session: {
      id: session.id,
      projectId: session.projectId,
      path: workspaceDir,
      title: session.title,
      type: session.type,
      status: session.status,
      externalSessionId: session.externalSessionId
    },
    globalStatePath
  }
}

describe('E2E: Composition seam', () => {
  const activeHosts: PtyHost[] = []

  afterEach(() => {
    for (const host of activeHosts.splice(0)) {
      host.dispose()
    }
  })

  test('pushes lifecycle session events through the real seam', async () => {
    const harness = await createCompositionHarness(activeHosts)

    await waitFor(() => getSessionEvents(harness.sent).length === 3)

    const sessionEvents = getSessionEvents(harness.sent)

    expect(sessionEvents).toHaveLength(3)
    expect(sessionEvents.map(event => event.status)).toEqual(['starting', 'running', 'exited'])
    expect(sessionEvents.map(event => event.sessionId)).toEqual([
      harness.session.id,
      harness.session.id,
      harness.session.id
    ])
    expect(sessionEvents.every(event => event.summary.length > 0)).toBe(true)

    const snapshotSession = harness.manager.snapshot().sessions.find(candidate => candidate.id === harness.session.id)
    expect(snapshotSession).toBeDefined()
    expect(snapshotSession!.status).toBe('exited')
  })

  test('flows terminal data from PTY through the controller to the window', async () => {
    const harness = await createCompositionHarness(activeHosts)

    await waitFor(() => getTerminalChunks(harness.sent).length > 0)
    await waitFor(() => getSessionEvents(harness.sent).some(event => event.status === 'exited'))

    const terminalChunks = getTerminalChunks(harness.sent)

    expect(terminalChunks.length).toBeGreaterThan(0)
    expect(terminalChunks.map(chunk => chunk.sessionId)).toEqual(
      terminalChunks.map(() => harness.session.id)
    )
    expect(terminalChunks.map(chunk => chunk.data).join('')).toContain('composition-seam-output')
  })

  test('persists lifecycle state that matches each pushed session transition', async () => {
    const workspaceDir = await createTestWorkspace('vibecoding-e2e-composition-')
    const globalStatePath = await createTestGlobalStatePath()

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    const project = await manager.createProject({
      path: workspaceDir,
      name: 'composition-seam-test'
    })

    const session = await manager.createSession({
      projectId: project.id,
      type: 'shell',
      title: 'Composition Shell'
    })

    const { window } = createMockWindow()
    const persistedStatesAtPush: Array<Promise<PersistedEventState>> = []
    const originalSend = window.webContents.send.bind(window.webContents)
    window.webContents.send = (channel: string, data: unknown) => {
      originalSend(channel, data)

      if (channel !== IPC_CHANNELS.sessionEvent) {
        return
      }

      const event = data as SessionStatusEvent
      persistedStatesAtPush.push(
        readProjectSessions(workspaceDir).then((diskSessions) => {
          const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === session.id)
          if (!persistedSession) {
            throw new Error(`Persisted session ${session.id} not found`)
          }

          return {
            pushedStatus: event.status,
            pushedSummary: event.summary,
            persistedStatus: persistedSession.last_known_status,
            persistedSummary: persistedSession.last_summary
          }
        })
      )
    }

    const controller = new SessionRuntimeController(manager, () => window)
    const ptyHost = new PtyHost()
    activeHosts.push(ptyHost)

    await startSessionRuntime({
      session: {
        id: session.id,
        projectId: session.projectId,
        path: workspaceDir,
        title: session.title,
        type: session.type,
        status: session.status,
        externalSessionId: session.externalSessionId
      },
      webhookPort: 43127,
      provider: createTestProvider('composition-seam-output'),
      ptyHost,
      manager: controller
    })

    await waitFor(() => persistedStatesAtPush.length === 3)

    const persistedMatches = await Promise.all(persistedStatesAtPush)

    expect(persistedMatches.map(match => match.pushedStatus)).toEqual(['starting', 'running', 'exited'])
    expect(persistedMatches.every((match) => {
      return match.pushedStatus === match.persistedStatus
        && match.pushedSummary === match.persistedSummary
    })).toBe(true)

    const diskSessions = await readProjectSessions(workspaceDir)
    const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === session.id)

    expect(persistedSession).toBeDefined()
    expect(persistedSession!.last_known_status).toBe('exited')
  })
})
