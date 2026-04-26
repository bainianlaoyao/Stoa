import { afterEach, describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import { PtyHost } from '@core/pty-host'
import { readProjectSessions } from '@core/state-store'
import { startSessionRuntime } from '@core/session-runtime'
import type { TerminalDataChunk } from '@shared/project-session'
import { SessionRuntimeController } from '../../src/main/session-runtime-controller'
import {
  createMockWindow,
  createTestProvider,
  createTestGlobalStatePath,
  createTestWorkspace
} from './helpers'

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
    runtimeState: 'created' | 'starting' | 'alive' | 'exited' | 'failed_to_start'
    agentState: 'unknown' | 'idle' | 'working' | 'blocked' | 'error'
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
      runtimeState: session.runtimeState,
      agentState: session.agentState,
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
      runtimeState: session.runtimeState,
      agentState: session.agentState,
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

  test('pushes lifecycle presence snapshots through the real seam', async () => {
    const harness = await createCompositionHarness(activeHosts)

    await waitFor(() => {
      const session = harness.manager.snapshot().sessions.find(candidate => candidate.id === harness.session.id)
      return session?.runtimeState === 'exited'
    })

    const snapshotSession = harness.manager.snapshot().sessions.find(candidate => candidate.id === harness.session.id)
    expect(snapshotSession).toBeDefined()
    expect(snapshotSession!.runtimeState).toBe('exited')
    expect(snapshotSession!.summary.length).toBeGreaterThan(0)
  })

  test('flows terminal data from PTY through the controller to the window', async () => {
    const harness = await createCompositionHarness(activeHosts)

    await waitFor(() => getTerminalChunks(harness.sent).length > 0)
    await waitFor(() => {
      const session = harness.manager.snapshot().sessions.find(candidate => candidate.id === harness.session.id)
      return session?.runtimeState === 'exited'
    })

    const terminalChunks = getTerminalChunks(harness.sent)

    expect(terminalChunks.length).toBeGreaterThan(0)
    expect(terminalChunks.map(chunk => chunk.sessionId)).toEqual(
      terminalChunks.map(() => harness.session.id)
    )
    expect(terminalChunks.map(chunk => chunk.data).join('')).toContain('composition-seam-output')
  })

  test('persists lifecycle state that matches each manager snapshot transition', async () => {
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

    const { window: win } = createMockWindow()
    const controller = new SessionRuntimeController(manager, () => win)
    const ptyHost = new PtyHost()
    activeHosts.push(ptyHost)

    await startSessionRuntime({
      session: {
        id: session.id,
        projectId: session.projectId,
        path: workspaceDir,
        title: session.title,
        type: session.type,
        runtimeState: session.runtimeState,
        agentState: session.agentState,
        externalSessionId: session.externalSessionId
      },
      webhookPort: 43127,
      provider: createTestProvider('composition-seam-output'),
      ptyHost,
      manager: controller
    })

    await waitFor(() => {
      const snapshotSession = manager.snapshot().sessions.find(candidate => candidate.id === session.id)
      return snapshotSession?.runtimeState === 'exited'
    })

    const diskSessions = await readProjectSessions(workspaceDir)
    const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === session.id)

    expect(persistedSession).toBeDefined()
    expect(persistedSession!.runtime_state).toBe('exited')

    const snapshotSession = manager.snapshot().sessions.find(candidate => candidate.id === session.id)
    expect(snapshotSession!.runtimeState).toBe(persistedSession!.runtime_state)
    expect(snapshotSession!.summary).toBe(persistedSession!.last_summary)
  })
})
