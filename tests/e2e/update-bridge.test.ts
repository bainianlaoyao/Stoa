import { describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { UpdateService } from '../../src/main/update-service'
import type { RendererApi } from '@shared/project-session'
import type { UpdateState } from '@shared/update-state'

class FakeIpcBus {
  private handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

  handle(channel: string, handler: (...args: unknown[]) => Promise<unknown>): void {
    this.handlers.set(channel, handler)
  }

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) {
      throw new Error(`No IPC handler registered for channel: ${channel}`)
    }

    return handler(undefined, ...args)
  }
}

function createUpdateApi(bus: FakeIpcBus): Pick<
  RendererApi,
  'getUpdateState' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstallUpdate'
> {
  return {
    getUpdateState: () => bus.invoke(IPC_CHANNELS.updateGetState) as Promise<UpdateState>,
    checkForUpdates: () => bus.invoke(IPC_CHANNELS.updateCheck) as Promise<UpdateState>,
    downloadUpdate: () => bus.invoke(IPC_CHANNELS.updateDownload) as Promise<UpdateState>,
    quitAndInstallUpdate: () => bus.invoke(IPC_CHANNELS.updateQuitAndInstall) as Promise<void>
  }
}

function registerUpdateHandlers(bus: FakeIpcBus): void {
  const service = new UpdateService({
    app: {
      isPackaged: false,
      getVersion: () => '0.1.0'
    },
    updater: {
      autoDownload: true,
      on: () => undefined,
      checkForUpdates: async () => null,
      downloadUpdate: async () => null,
      quitAndInstall: () => undefined
    },
    sessionManager: {
      snapshot: () => ({
        activeProjectId: null,
        activeSessionId: null,
        terminalWebhookPort: null,
        projects: [],
        sessions: []
      })
    },
    showSessionWarningDialog: async () => true
  })

  bus.handle(IPC_CHANNELS.updateGetState, async () => service.getState())
  bus.handle(IPC_CHANNELS.updateCheck, async () => service.checkForUpdates())
  bus.handle(IPC_CHANNELS.updateDownload, async () => service.downloadUpdate())
  bus.handle(IPC_CHANNELS.updateQuitAndInstall, async () => service.quitAndInstall())
}

describe('E2E: Update Bridge', () => {
  test('unpackaged update handlers return disabled state through the bridge', async () => {
    const bus = new FakeIpcBus()
    registerUpdateHandlers(bus)
    const api = createUpdateApi(bus)

    await expect(api.getUpdateState()).resolves.toEqual({
      phase: 'disabled',
      currentVersion: '0.1.0',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: 'Updates are only available in packaged builds.',
      requiresSessionWarning: false
    })

    await expect(api.checkForUpdates()).resolves.toMatchObject({
      phase: 'disabled',
      currentVersion: '0.1.0'
    })
    await expect(api.downloadUpdate()).resolves.toMatchObject({
      phase: 'disabled',
      currentVersion: '0.1.0'
    })
    await expect(api.quitAndInstallUpdate()).resolves.toBeUndefined()
  })
})
