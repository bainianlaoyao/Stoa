import { afterEach, describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import { PtyHost } from '@core/pty-host'
import { readProjectSessions } from '@core/state-store'
import { startSessionRuntime } from '@core/session-runtime'
import type { SessionSummaryEvent, TerminalDataChunk } from '@shared/project-session'
import { SessionRuntimeController } from '../../src/main/session-runtime-controller'
import {
  createMockWindow,
  createTestProvider,
  createTestGlobalStatePath,
  createTestWorkspace
} from './helpers'

interface PersistedEventState {
  pushedRuntimeState: SessionSummaryEvent['session']['runtimeState']
  pushedSummary: string
  persistedRuntimeState: SessionSummaryEvent['session']['runtimeState']
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

function getSessionEvents(sent: Array<{ channel: string; data: unknown }>): SessionSummaryEvent[] {
  return sent
    .filter(entry => entry.channel === IPC_CHANNELS.sessionEvent)
    .map(entry => {
      expect(entry.data).toEqual({
        session: expect.objectContaining({
          id: expect.any(String)
        })
      })
      expect(entry.data).not.toHaveProperty('sessionId')
      expect(entry.data).not.toHaveProperty('status')

      return entry.data as SessionSummaryEvent
    })
}

function getTerminalChunks(sent: Array<{ channel: string; data: unknown }>): TerminalDataChunk[] {
  return sent
    .filter(entry => entry.channel === IPC_CHANNELS.terminalData)
    .map(entry => entry.data as TerminalDataChunk)
}

async function createCompositionHarness(activeHosts: PtyHost[]): Promise<CompositionHarness> {
  const workspaceDir = await createTestWorkspace('stoa-e2e-composition-')
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
    expect(sessionEvents.map(event => event.session.runtimeState)).toEqual(['starting', 'alive', 'exited'])
    expect(sessionEvents.map(event => event.session.id)).toEqual([
      harness.session.id,
      harness.session.id,
      harness.session.id
    ])
    expect(sessionEvents.every(event => event.session.summary.length > 0)).toBe(true)

    const snapshotSession = harness.manager.snapshot().sessions.find(candidate => candidate.id === harness.session.id)
    expect(snapshotSession).toBeDefined()
    expect(snapshotSession!.runtimeState).toBe('exited')
  })

  test('flows terminal data from PTY through the controller to the window', async () => {
    const harness = await createCompositionHarness(activeHosts)

    await waitFor(() => getTerminalChunks(harness.sent).length > 0)
    await waitFor(() => getSessionEvents(harness.sent).some(event => event.session.runtimeState === 'exited'))

    const terminalChunks = getTerminalChunks(harness.sent)

    expect(terminalChunks.length).toBeGreaterThan(0)
    expect(terminalChunks.map(chunk => chunk.sessionId)).toEqual(
      terminalChunks.map(() => harness.session.id)
    )
    expect(terminalChunks.map(chunk => chunk.data).join('')).toContain('composition-seam-output')
  })

  test('persists lifecycle state that matches each pushed session transition', async () => {
    const workspaceDir = await createTestWorkspace('stoa-e2e-composition-')
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

      expect(data).toEqual({
        session: expect.objectContaining({
          id: expect.any(String)
        })
      })
      expect(data).not.toHaveProperty('sessionId')
      expect(data).not.toHaveProperty('status')

      const event = data as SessionSummaryEvent
      persistedStatesAtPush.push(
        readProjectSessions(workspaceDir).then((diskSessions) => {
          const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === session.id)
          if (!persistedSession) {
            throw new Error(`Persisted session ${session.id} not found`)
          }

          return {
            pushedRuntimeState: event.session.runtimeState,
            pushedSummary: event.session.summary,
            persistedRuntimeState: persistedSession.runtime_state,
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

    expect(persistedMatches.map(match => match.pushedRuntimeState)).toEqual(['starting', 'alive', 'exited'])
    expect(persistedMatches.every((match) => {
      return match.pushedRuntimeState === match.persistedRuntimeState
        && match.pushedSummary === match.persistedSummary
    })).toBe(true)

    const diskSessions = await readProjectSessions(workspaceDir)
    const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === session.id)

    expect(persistedSession).toBeDefined()
    expect(persistedSession!.runtime_state).toBe('exited')
  })
})
