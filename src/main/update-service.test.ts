import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { UpdateService } from './update-service'
import type { BootstrapState } from '@shared/project-session'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  checkForUpdates = vi.fn(async () => null)
  downloadUpdate = vi.fn(async () => null)
  quitAndInstall = vi.fn()
}

function createSnapshot(overrides?: Partial<BootstrapState>): BootstrapState {
  return {
    activeProjectId: null,
    activeSessionId: null,
    terminalWebhookPort: null,
    projects: [],
    sessions: [],
    ...overrides
  }
}

describe('UpdateService', () => {
  test('forces autoDownload off for the updater transport', () => {
    const updater = new FakeUpdater()
    const writeLog = vi.fn(async () => undefined)

    new UpdateService({
      app: {
        isPackaged: false,
        getVersion: () => '1.2.3'
      },
      updater,
      sessionManager: {
        snapshot: () => createSnapshot()
      },
      showSessionWarningDialog: async () => true,
      writeLog
    })

    expect(updater.autoDownload).toBe(false)
    expect(writeLog).toHaveBeenCalled()
  })

  test('returns disabled state and skips updater checks when app is not packaged', async () => {
    const updater = new FakeUpdater()
    const service = new UpdateService({
      app: {
        isPackaged: false,
        getVersion: () => '1.2.3'
      },
      updater,
      sessionManager: {
        snapshot: () => createSnapshot()
      },
      showSessionWarningDialog: async () => true
    })

    await expect(service.getState()).resolves.toEqual({
      phase: 'disabled',
      currentVersion: '1.2.3',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: 'Updates are only available in packaged builds.',
      requiresSessionWarning: false
    })

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      phase: 'disabled',
      currentVersion: '1.2.3'
    })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  test('marks downloaded state as requiring a session warning when active sessions exist', async () => {
    const updater = new FakeUpdater()
    const service = new UpdateService({
      app: {
        isPackaged: true,
        getVersion: () => '1.2.3'
      },
      updater,
      sessionManager: {
        snapshot: () => createSnapshot({
          sessions: [
            {
              id: 'session-1',
              projectId: 'project-1',
              type: 'shell',
              status: 'running',
              title: 'Shell',
              summary: 'Running',
              recoveryMode: 'fresh-shell',
              externalSessionId: null,
              createdAt: '2026-04-24T00:00:00.000Z',
              updatedAt: '2026-04-24T00:00:00.000Z',
              lastActivatedAt: '2026-04-24T00:00:00.000Z',
              archived: false
            }
          ]
        })
      },
      showSessionWarningDialog: async () => true
    })

    updater.emit('update-downloaded', { version: '1.3.0' })

    await expect(service.getState()).resolves.toMatchObject({
      phase: 'downloaded',
      downloadedVersion: '1.3.0',
      requiresSessionWarning: true
    })
  })

  test('prompts before quitAndInstall and aborts when the warning is dismissed', async () => {
    const updater = new FakeUpdater()
    const showSessionWarningDialog = vi.fn(async () => false)
    const service = new UpdateService({
      app: {
        isPackaged: true,
        getVersion: () => '1.2.3'
      },
      updater,
      sessionManager: {
        snapshot: () => createSnapshot({
          sessions: [
            {
              id: 'session-1',
              projectId: 'project-1',
              type: 'shell',
              status: 'running',
              title: 'Shell',
              summary: 'Running',
              recoveryMode: 'fresh-shell',
              externalSessionId: null,
              createdAt: '2026-04-24T00:00:00.000Z',
              updatedAt: '2026-04-24T00:00:00.000Z',
              lastActivatedAt: '2026-04-24T00:00:00.000Z',
              archived: false
            }
          ]
        })
      },
      showSessionWarningDialog
    })

    updater.emit('update-downloaded', { version: '1.3.0' })

    await service.quitAndInstall()

    expect(showSessionWarningDialog).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  test('runs the pre-install hook before quitAndInstall when install is allowed', async () => {
    const updater = new FakeUpdater()
    const prepareToInstall = vi.fn(async () => undefined)
    const service = new UpdateService({
      app: {
        isPackaged: true,
        getVersion: () => '1.2.3'
      },
      updater,
      sessionManager: {
        snapshot: () => createSnapshot()
      },
      showSessionWarningDialog: async () => true,
      prepareToInstall
    })

    updater.emit('update-downloaded', { version: '1.3.0' })

    await service.quitAndInstall()

    expect(prepareToInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  test('publishState refreshes requiresSessionWarning from live session state', async () => {
    const updater = new FakeUpdater()
    const onStateChange = vi.fn()
    const sessions: BootstrapState['sessions'] = []
    const service = new UpdateService({
      app: {
        isPackaged: true,
        getVersion: () => '1.2.3'
      },
      updater,
      sessionManager: {
        snapshot: () => createSnapshot({ sessions })
      },
      showSessionWarningDialog: async () => true,
      onStateChange
    })

    updater.emit('update-downloaded', { version: '1.3.0' })
    sessions.push({
      id: 'session-1',
      projectId: 'project-1',
      type: 'shell',
      status: 'running',
      title: 'Shell',
      summary: 'Running',
      recoveryMode: 'fresh-shell',
      externalSessionId: null,
      createdAt: '2026-04-24T00:00:00.000Z',
      updatedAt: '2026-04-24T00:00:00.000Z',
      lastActivatedAt: '2026-04-24T00:00:00.000Z',
      archived: false
    })

    const published = service.publishState()

    expect(published.requiresSessionWarning).toBe(true)
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'downloaded',
        requiresSessionWarning: true
      })
    )
  })

  test('downloaded to available clears stale install-ready fields', async () => {
    const updater = new FakeUpdater()
    const service = new UpdateService({
      app: {
        isPackaged: true,
        getVersion: () => '1.2.3'
      },
      updater,
      sessionManager: {
        snapshot: () => createSnapshot()
      },
      showSessionWarningDialog: async () => true
    })

    updater.emit('update-downloaded', { version: '1.3.0' })
    updater.emit('update-available', { version: '1.4.0' })

    await expect(service.getState()).resolves.toEqual(
      expect.objectContaining({
        phase: 'available',
        availableVersion: '1.4.0',
        downloadedVersion: null,
        downloadProgressPercent: null
      })
    )
  })

  test('writes update log entries for state transitions and install decisions', async () => {
    const updater = new FakeUpdater()
    const writeLog = vi.fn(async () => undefined)
    const service = new UpdateService({
      app: {
        isPackaged: true,
        getVersion: () => '1.2.3'
      },
      updater,
      sessionManager: {
        snapshot: () => createSnapshot({
          sessions: [
            {
              id: 'session-1',
              projectId: 'project-1',
              type: 'shell',
              status: 'running',
              title: 'Shell',
              summary: 'Running',
              recoveryMode: 'fresh-shell',
              externalSessionId: null,
              createdAt: '2026-04-24T00:00:00.000Z',
              updatedAt: '2026-04-24T00:00:00.000Z',
              lastActivatedAt: '2026-04-24T00:00:00.000Z',
              archived: false
            }
          ]
        })
      },
      showSessionWarningDialog: async () => false,
      writeLog
    })

    updater.emit('update-available', { version: '1.3.0' })
    updater.emit('update-downloaded', { version: '1.3.0' })
    await service.quitAndInstall()

    expect(writeLog).toHaveBeenCalledWith(expect.stringContaining('state phase=available'))
    expect(writeLog).toHaveBeenCalledWith(expect.stringContaining('state phase=downloaded'))
    expect(writeLog).toHaveBeenCalledWith('install blocked by active sessions pending confirmation')
    expect(writeLog).toHaveBeenCalledWith('install cancelled after session warning')
  })

  test('swallows update log write failures', async () => {
    const updater = new FakeUpdater()
    const writeLog = vi.fn(async () => {
      throw new Error('disk full')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const service = new UpdateService({
      app: {
        isPackaged: true,
        getVersion: () => '1.2.3'
      },
      updater,
      sessionManager: {
        snapshot: () => createSnapshot()
      },
      showSessionWarningDialog: async () => true,
      writeLog
    })

    updater.emit('update-available', { version: '1.3.0' })
    await Promise.resolve()

    expect(service).toBeDefined()
    expect(consoleError).toHaveBeenCalledWith(
      '[update-log] Failed to write update log entry:',
      expect.any(Error)
    )

    consoleError.mockRestore()
  })
})
