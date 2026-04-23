import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { SessionRuntimeController } from './session-runtime-controller'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import { createTestTempDir } from '../../testing/test-temp'

const tempDirs: string[] = []

async function createTestWorkspace(name: string): Promise<string> {
  const dir = await createTestTempDir(name)
  tempDirs.push(dir)
  return dir
}

async function createTestGlobalStatePath(): Promise<string> {
  const dir = await createTestTempDir('stoa-controller-state-')
  tempDirs.push(dir)
  return join(dir, 'global.json')
}

function createMockWindow() {
  const sent: Array<{ channel: string; data: unknown }> = []
  return {
    window: {
      isDestroyed: () => false,
      webContents: {
        send(channel: string, data: unknown) {
          sent.push({ channel, data })
        }
      }
    },
    sent,
    lastSend() { return sent[sent.length - 1] }
  }
}

describe('SessionRuntimeController', () => {
  let manager: ProjectSessionManager

  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true }))
    )
  })

  beforeEach(async () => {
    const globalStatePath = await createTestGlobalStatePath()
    manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
  })

  test('markSessionStarting updates manager and pushes session event', async () => {
    const { window: win } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.markSessionStarting(session.id, 'starting shell', null)

    expect(manager.snapshot().sessions[0]!.status).toBe('starting')
  })

  test('markSessionStarting sends session event via IPC', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.markSessionStarting(session.id, 'starting shell', null)

    expect(sent).toHaveLength(1)
    expect(sent[0]!.channel).toBe(IPC_CHANNELS.sessionEvent)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'starting',
      summary: 'starting shell'
    })
  })

  test('markSessionRunning updates manager and pushes session event', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.markSessionRunning(session.id, 'pty-123')

    expect(manager.snapshot().sessions[0]!.status).toBe('running')
    expect(manager.snapshot().sessions[0]!.externalSessionId).toBe('pty-123')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'running',
      summary: '会话运行中'
    })
  })

  test('markSessionExited updates manager and pushes session event', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.markSessionExited(session.id, 'shell 已退出 (0)')

    expect(manager.snapshot().sessions[0]!.status).toBe('exited')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'exited',
      summary: 'shell 已退出 (0)'
    })
  })

  test('applySessionEvent updates manager state and pushes awaiting_input via IPC', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.applySessionEvent({
      sessionId: session.id,
      status: 'awaiting_input',
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })

    const updated = manager.snapshot().sessions[0]!
    expect(updated.status).toBe('awaiting_input')
    expect(updated.summary).toBe('session.idle')
    expect(updated.externalSessionId).toBe('opencode-real-123')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'awaiting_input',
      summary: 'session.idle'
    })
  })

  test('markSessionRunning pushes the actual preserved manager state when richer status already won', async () => {
    const { window: win, sent } = createMockWindow()
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })
    const controller = new SessionRuntimeController(manager, () => win)

    await controller.applySessionEvent({
      sessionId: session.id,
      status: 'awaiting_input',
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })
    sent.length = 0

    await controller.markSessionRunning(session.id, 'opencode-real-456')

    const updated = manager.snapshot().sessions[0]!
    expect(updated.status).toBe('awaiting_input')
    expect(updated.summary).toBe('session.idle')
    expect(updated.externalSessionId).toBe('opencode-real-456')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.data).toEqual({
      sessionId: session.id,
      status: 'awaiting_input',
      summary: 'session.idle'
    })
  })

  test('appendTerminalData pushes terminal data to renderer', async () => {
    const { window: win, sent } = createMockWindow()

    const controller = new SessionRuntimeController(manager, () => win)
    await controller.appendTerminalData({ sessionId: 's1', data: 'hello world' })

    expect(sent).toHaveLength(1)
    expect(sent[0]!.channel).toBe(IPC_CHANNELS.terminalData)
    expect(sent[0]!.data).toEqual({ sessionId: 's1', data: 'hello world' })
  })

  test('getTerminalReplay returns the accumulated backlog for a running session', async () => {
    const { window: win } = createMockWindow()
    const controller = new SessionRuntimeController(manager, () => win)

    await controller.appendTerminalData({ sessionId: 'session-op-1', data: 'hello ' })
    await controller.appendTerminalData({ sessionId: 'session-op-1', data: 'world' })

    expect(controller.getTerminalReplay).toBeTypeOf('function')
    await expect(controller.getTerminalReplay('session-op-1')).resolves.toBe('hello world')
  })

  test('getTerminalReplay keeps session backlogs isolated', async () => {
    const { window: win } = createMockWindow()
    const controller = new SessionRuntimeController(manager, () => win)

    await controller.appendTerminalData({ sessionId: 'session-shell-1', data: 'shell' })
    await controller.appendTerminalData({ sessionId: 'session-op-2', data: 'opencode' })

    expect(controller.getTerminalReplay).toBeTypeOf('function')
    await expect(controller.getTerminalReplay('session-shell-1')).resolves.toBe('shell')
    await expect(controller.getTerminalReplay('session-op-2')).resolves.toBe('opencode')
  })

  test('appendTerminalData is no-op when window is destroyed', async () => {
    const destroyedWin = {
      isDestroyed: () => true,
      webContents: {
        send: () => { throw new Error('should not be called') }
      }
    }

    const controller = new SessionRuntimeController(
      manager,
      () => destroyedWin
    )
    await expect(
      controller.appendTerminalData({ sessionId: 's1', data: 'test' })
    ).resolves.toBeUndefined()
  })

  test('all methods work when window getter returns null', async () => {
    const project = await manager.createProject({ path: await createTestWorkspace('ctrl-null-'), name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    const controller = new SessionRuntimeController(manager, () => null)

    await controller.markSessionStarting(session.id, 'start', null)
    await controller.appendTerminalData({ sessionId: session.id, data: 'x' })

    expect(manager.snapshot().sessions[0]!.status).toBe('starting')
  })
})
