import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf-8')
}

const mainSource = readSrc('src/main/index.ts')
const preloadSource = readSrc('src/preload/index.ts')
const channelsSource = readSrc('src/core/ipc-channels.ts')
const preloadPathSource = readSrc('src/main/preload-path.ts')
const sharedTypesSource = readSrc('src/shared/index.d.ts')
const projectSessionSource = readSrc('src/shared/project-session.ts')
const controllerSource = readSrc('src/main/session-runtime-controller.ts')
const desktopBootstrapSource = readSrc('src/renderer/bootstrap-electron.ts')
const stoaServerE2eSource = readSrc('stoa-server/e2e-test.mjs')

function extractObjectBlock(source: string, keyword: string): string | null {
  const idx = source.indexOf(keyword)
  if (idx === -1) return null
  const afterKeyword = source.slice(idx + keyword.length)
  const braceStart = afterKeyword.indexOf('{')
  if (braceStart === -1) return null
  let depth = 0
  let i = braceStart
  for (; i < afterKeyword.length; i++) {
    if (afterKeyword[i] === '{') depth++
    else if (afterKeyword[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return afterKeyword.slice(braceStart + 1, i)
}

function extractWebPreferencesBlock(source: string): string | null {
  return extractObjectBlock(source, 'webPreferences')
}

function extractReturnObjectBlock(source: string): string | null {
  const returnMatch = source.match(/return\s*\{/)
  if (!returnMatch) return null
  const idx = source.indexOf(returnMatch[0])
  const afterReturn = source.slice(idx + returnMatch[0].length - 1)
  let depth = 0
  let i = 0
  for (; i < afterReturn.length; i++) {
    if (afterReturn[i] === '{') depth++
    else if (afterReturn[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return afterReturn.slice(1, i)
}

function extractNamedFunctionBody(source: string, functionName: string): string | null {
  const idx = source.indexOf(`function ${functionName}`)
  if (idx === -1) return null
  const afterName = source.slice(idx)
  const braceStart = afterName.indexOf('{')
  if (braceStart === -1) return null
  let depth = 0
  let i = braceStart
  for (; i < afterName.length; i++) {
    if (afterName[i] === '{') depth++
    else if (afterName[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return afterName.slice(braceStart + 1, i)
}

function extractIpcMainHandlers(source: string): Map<string, string> {
  const handlers = new Map<string, string>()
  const pattern = /ipcMain\.handle\(([^,]+),\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{?([^]*?)\)\s*\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const channelRaw = match[1].trim()
    const body = match[3].trim()
    handlers.set(channelRaw, body)
  }
  return handlers
}

function extractPreloadChannelInvokes(source: string): Array<{ method: string; channel: string }> {
  const results: Array<{ method: string; channel: string }> = []
  const methodPattern = /async\s+(\w+)\([^)]*\)\s*\{[^}]*ipcRenderer\.invoke\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = methodPattern.exec(source)) !== null) {
    const method = match[1]
    const channelRaw = match[2].split(',')[0].trim()
    results.push({ method, channel: channelRaw })
  }
  return results
}

function resolveChannelReference(channel: string, constants: Map<string, string>): string {
  const trimmed = channel.trim()
  const constantMatch = trimmed.match(/^IPC_CHANNELS\.(\w+)$/)

  if (constantMatch) {
    return constants.get(constantMatch[1]) ?? trimmed
  }

  return trimmed.replace(/['"]/g, '')
}

function extractChannelConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>()
  const pattern = /(\w+)\s*:\s*'([^']+)'/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    constants.set(match[1], match[2])
  }
  return constants
}

function extractRendererApiMethods(source: string): string[] {
  const methods: string[] = []
  const interfaceMatch = source.match(/export interface RendererApi \{([^}]*)\}/)
  if (!interfaceMatch) return methods
  const methodPattern = /(\w+)\s*[:(]/g
  let match: RegExpExecArray | null
  while ((match = methodPattern.exec(interfaceMatch[1])) !== null) {
    if (match[1] !== 'Promise' && match[1] !== 'void') {
      methods.push(match[1])
    }
  }
  return [...new Set(methods)]
}

describe('E2E: Main Process Config Guard', () => {
  describe('BrowserWindow webPreferences', () => {
    it('main/index.ts webPreferences must include sandbox: false', () => {
      const prefs = extractWebPreferencesBlock(mainSource)
      expect(prefs).not.toBeNull()

      // Must match `sandbox: false` or `sandbox : false` inside webPreferences —
      // NOT a comment or elsewhere in the file.
      const sandboxPattern = /sandbox\s*:\s*false\b/
      expect(
        sandboxPattern.test(prefs!),
        `Expected webPreferences to contain "sandbox: false" but got:\n${prefs}`
      ).toBe(true)
    })

    it('main/index.ts webPreferences matches preload-path.ts security config', () => {
      const mainPrefs = extractWebPreferencesBlock(mainSource)
      const pathPrefs = extractReturnObjectBlock(preloadPathSource)

      expect(mainPrefs).not.toBeNull()
      expect(pathPrefs).not.toBeNull()

      const requiredKeys = ['contextIsolation', 'nodeIntegration', 'sandbox']
      for (const key of requiredKeys) {
        expect(pathPrefs!).toMatch(new RegExp(key))
      }

      expect(pathPrefs!).toMatch(/contextIsolation\s*:\s*true/)
      expect(pathPrefs!).toMatch(/nodeIntegration\s*:\s*false/)
      expect(pathPrefs!).toMatch(/sandbox\s*:\s*false/)
    })

    it('preload path in main/index.ts ends with .cjs extension', () => {
      expect(mainSource).toMatch(/preload[/'"]+index\.cjs['"]\)/)
    })
  })

  describe('Provider routing guard', () => {
    it('main/index.ts does not hardcode shell/opencode provider ternary routing anymore', () => {
      expect(mainSource).not.toContain("session.type === 'shell' ? 'local-shell' : 'opencode'")
    })

    it('main/index.ts wires shared runtime-root hook lease management into session launch', () => {
      expect(mainSource).toMatch(/resolveDefaultStoaRuntimeRoot\(/)
      expect(mainSource).toMatch(/createHookLeaseManager\(/)
      expect(mainSource).toMatch(/hookLeaseManager\s*:/)
      expect(mainSource).toMatch(/launchTrackedSessionRuntime\({/)
    })

    it('packaged smoke validates Claude command-hook dispatcher contract instead of legacy HTTP hooks', () => {
      expect(mainSource).toContain("claude-session-start-hook-verified")
      expect(mainSource).toContain(".stoa/hook-dispatch claude-code SessionStart")
      expect(mainSource).not.toContain('Packaged smoke Claude SessionStart hook must be HTTP')
      expect(mainSource).not.toContain('/hooks/claude-code')
      expect(mainSource).not.toContain('${STOA_SESSION_SECRET}')
    })

    it('main/index.ts cuts over to the unified session command env and bootstrap prompt service', () => {
      expect(mainSource).toContain("from '@core/session-command-env'")
      expect(mainSource).toContain("from '@core/session-bootstrap-prompt-service'")
      expect(mainSource).toContain('buildSessionCommandEnv(')
      expect(mainSource).toContain('SessionBootstrapPromptService')
      expect(mainSource).not.toContain("from '@core/meta-session-command-env'")
      expect(mainSource).not.toContain("from '@core/meta-session-bootstrap-prompt'")
      expect(mainSource).not.toContain('buildMetaSessionCommandEnv(')
      expect(mainSource).not.toContain('buildMetaSessionBootstrapPrompt(')
      expect(mainSource).not.toContain('launchMetaSessionRuntimeWithGuard(')
    })

    it('initializes a unified ctlSecret before the shared webhook server starts', () => {
      const ctlSecretIndex = mainSource.indexOf('const ctlSecret = generateSecret()')
      const bridgeStartIndex = mainSource.indexOf('const webhookPort = await sessionEventBridge.start()')

      expect(ctlSecretIndex, 'Could not find ctlSecret initialization in main/index.ts').toBeGreaterThan(-1)
      expect(bridgeStartIndex, 'Could not find shared webhook server startup in main/index.ts').toBeGreaterThan(-1)
      expect(ctlSecretIndex).toBeLessThan(bridgeStartIndex)
      expect(mainSource).toContain('ctlSecret')
    })

    it('main process passes the repository root to the development SR spawner', () => {
      const srDeps = extractObjectBlock(mainSource, 'const srDeps: SpawnerDeps =')

      expect(srDeps, 'Could not find Stoa Server spawner deps in main/index.ts').not.toBeNull()
      expect(srDeps!).toMatch(/getAppRootPath\s*:\s*\(\)\s*=>\s*process\.cwd\(\)/)
      expect(srDeps!).not.toMatch(/getAppRootPath\s*:\s*\(\)\s*=>\s*app\.getAppPath\(\)/)
    })

    it('main process runs the development SR with the host Node executable', () => {
      const srDeps = extractObjectBlock(mainSource, 'const srDeps: SpawnerDeps =')

      expect(srDeps, 'Could not find Stoa Server spawner deps in main/index.ts').not.toBeNull()
      expect(srDeps!).toMatch(/getNodeExecPath\s*:\s*\(\)\s*=>\s*process\.env\.npm_node_execpath\s*\?\?\s*'node'/)
    })

    it('main process isolates Electron userData for packaged smoke and E2E runs', () => {
      expect(mainSource).toContain("const isolatedUserDataDir = isPackagedSmokeMode")
      expect(mainSource).toContain("? process.env.VIBECODING_STATE_DIR ?? packagedSmokeRequest.stateDir")
      expect(mainSource).toContain(": isE2EMode")
      expect(mainSource).toContain("? process.env.VIBECODING_STATE_DIR ?? null")
      expect(mainSource).toMatch(/if \(isolatedUserDataDir\) \{\s*app\.setPath\('userData', isolatedUserDataDir\)\s*\}/s)
    })

    it('standalone Stoa Server e2e uses an isolated runtime STOA_DIR', () => {
      expect(stoaServerE2eSource).toContain('STOA_DIR')
      expect(stoaServerE2eSource).toContain('TEST_STOA_DIR')
      expect(stoaServerE2eSource).toContain('STOA_AUTH_TOKEN')
      expect(stoaServerE2eSource).not.toContain('STOA_DB_PATH')
      expect(stoaServerE2eSource).not.toMatch(/homedir\s*\(\s*\)/)
      expect(stoaServerE2eSource).not.toMatch(/join\([^)]*['"]\.stoa['"]/)
    })
  })

  describe('IPC handler registration completeness', () => {
    it('every Electron native invoke method has a corresponding ipcMain.handle registration', () => {
      const rendererApiMethods = [
        'getServerInfo',
        'openWorkspace',
        'titleGenerationFetchModels',
        'pickFolder',
        'pickFile',
        'detectShell',
        'detectProvider',
        'detectVscode',
        'getUpdateState',
        'checkForUpdates',
        'downloadUpdate',
        'quitAndInstallUpdate',
        'dismissUpdate',
        'minimizeWindow',
        'maximizeWindow',
        'closeWindow',
        'isWindowMaximized',
        'fsOpenFile',
        'shellShowItemInFolder'
      ]
      const channelToConstant = new Map<string, string>([
        ['getServerInfo', 'serverGetInfo'],
        ['openWorkspace', 'workspaceOpen'],
        ['titleGenerationFetchModels', 'titleGenerationFetchModels'],
        ['pickFolder', 'dialogPickFolder'],
        ['pickFile', 'dialogPickFile'],
        ['detectShell', 'settingsDetectShell'],
        ['detectProvider', 'settingsDetectProvider'],
        ['detectVscode', 'settingsDetectVscode'],
        ['getUpdateState', 'updateGetState'],
        ['checkForUpdates', 'updateCheck'],
        ['downloadUpdate', 'updateDownload'],
        ['quitAndInstallUpdate', 'updateQuitAndInstall'],
        ['dismissUpdate', 'updateDismiss'],
        ['minimizeWindow', 'windowMinimize'],
        ['maximizeWindow', 'windowMaximize'],
        ['closeWindow', 'windowClose'],
        ['isWindowMaximized', 'windowIsMaximized'],
        ['fsOpenFile', 'fsOpenFile'],
        ['shellShowItemInFolder', 'shellShowItemInFolder']
      ])

      for (const method of rendererApiMethods) {
        const constantName = channelToConstant.get(method)
        if (!constantName) continue
        const pattern = new RegExp(
          `ipcMain\\.handle\\(\\s*IPC_CHANNELS\\.${constantName}\\b`
        )
        expect(
          mainSource,
          `Missing ipcMain.handle(IPC_CHANNELS.${constantName}) for method "${method}"`
        ).toMatch(pattern)
      }
    })

    it('all channel strings in preload match IPC_CHANNELS constants', () => {
      const preloadInvokes = extractPreloadChannelInvokes(preloadSource)
      const constants = extractChannelConstants(channelsSource)
      const constantValues = new Set(constants.values())

      for (const { method, channel } of preloadInvokes) {
        const channelStr = resolveChannelReference(channel, constants)
        expect(
          constantValues.has(channelStr),
          `Preload method "${method}" uses channel "${channelStr}" which is not in IPC_CHANNELS`
        ).toBe(true)
      }
    })

    it('main/index.ts uses IPC_CHANNELS constants for handler registration', () => {
      const handlePattern = /ipcMain\.handle\(\s*IPC_CHANNELS\.\w+/g
      const matches = mainSource.match(handlePattern)

      expect(matches, 'Expected ipcMain.handle calls to reference IPC_CHANNELS.xxx').not.toBeNull()
      expect(matches!.length).toBeGreaterThanOrEqual(14)
    })

    it('IPC handler for project:create calls createProject', () => {
      const handlerPattern = /ipcMain\.handle\([^)]*projectCreate[^,]*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?([^}]*\})/s
      const match = mainSource.match(handlerPattern)
      expect(match, 'Could not find handler for projectCreate').not.toBeNull()
      expect(match![1]).toMatch(/createProject/)
    })

    it('IPC handler for session:create calls createSession', () => {
      const handlerPattern = /ipcMain\.handle\([^)]*sessionCreate[^,]*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?([^}]*\})/s
      const match = mainSource.match(handlerPattern)
      expect(match, 'Could not find handler for sessionCreate').not.toBeNull()
      expect(match![1]).toMatch(/createWorkSessionWithRuntime/)
    })

    it('IPC handler for session:restart exists', () => {
      expect(mainSource).toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.sessionRestart\b/)
    })

    it('IPC handler for project:bootstrap calls snapshot', () => {
      const handlerPattern = /ipcMain\.handle\([^)]*projectBootstrap[^,]*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?([^}]*\})/s
      const match = mainSource.match(handlerPattern)
      expect(match, 'Could not find handler for projectBootstrap').not.toBeNull()
      expect(match![1]).toMatch(/snapshot/)
    })

    it('main/index.ts registers all update invoke handlers', () => {
      const requiredUpdateHandlers = [
        'updateGetState',
        'updateCheck',
        'updateDownload',
        'updateQuitAndInstall',
        'updateDismiss'
      ]

      for (const channel of requiredUpdateHandlers) {
        expect(mainSource).toMatch(new RegExp(`ipcMain\\.handle\\(\\s*IPC_CHANNELS\\.${channel}\\b`))
      }
    })

    it('main/index.ts registers sidebar state handlers', () => {
      expect(mainSource).toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.sidebarGetState\b/)
      expect(mainSource).toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.sidebarSetState\b/)
    })

    it('main/index.ts registers fs:open-file handler', () => {
      expect(mainSource).toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.fsOpenFile\b/)
    })

    it('main/index.ts registers shell:show-item-in-folder handler', () => {
      expect(mainSource).toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.shellShowItemInFolder\b/)
    })

    it('main/index.ts imports and calls registerFilesystemHandlers', () => {
      expect(mainSource).toMatch(/import.*registerFilesystemHandlers.*from.*sidebar-fs-handlers/)
      expect(mainSource).toMatch(/registerFilesystemHandlers\(ipcMain/)
    })
  })

  describe('Preload type contract completeness', () => {
    it('preload api object implements all Electron native invoke methods', () => {
      const knownInvokeMethods = [
        'getServerInfo',
        'openWorkspace',
        'titleGenerationFetchModels',
        'pickFolder',
        'pickFile',
        'detectShell',
        'detectProvider',
        'detectVscode',
        'getUpdateState',
        'checkForUpdates',
        'downloadUpdate',
        'quitAndInstallUpdate',
        'dismissUpdate',
        'minimizeWindow',
        'maximizeWindow',
        'closeWindow',
        'isWindowMaximized',
        'fsOpenFile',
        'shellShowItemInFolder',
      ]

      for (const method of knownInvokeMethods) {
        expect(
          preloadSource,
          `Preload is missing invoke method "${method}"`
        ).toMatch(new RegExp(`async\\s+${method}\\s*\\(`))
      }

      const methodCount = preloadSource.match(/async\s+\w+\s*\(/g)
      expect(
        methodCount,
        `Expected exactly ${knownInvokeMethods.length} invoke methods in preload api`
      ).toHaveLength(knownInvokeMethods.length)

      const stoaRuntimeAdapterMethods = [
        'archiveSession',
        'regenerateSessionTitle',
        'restoreSession',
        'restartSession',
        'listArchivedSessions',
      ]

      for (const method of stoaRuntimeAdapterMethods) {
        expect(
          preloadSource,
          `Preload must not expose SR adapter method "${method}"`
        ).not.toMatch(new RegExp(`async\\s+${method}\\s*\\(`))
      }
    })

    it('preload uses correct channel name for each method', () => {
      const invocations = extractPreloadChannelInvokes(preloadSource)
      const constants = extractChannelConstants(channelsSource)
      const invMap = new Map(
        invocations.map(({ method, channel }) => [method, resolveChannelReference(channel, constants)])
      )

      expect(invMap.get('getServerInfo')).toBe('server:get-info')
      expect(invMap.get('openWorkspace')).toBe('workspace:open')
      expect(invMap.get('titleGenerationFetchModels')).toBe('settings:title-generation-fetch-models')
      expect(invMap.get('pickFolder')).toBe('dialog:pick-folder')
      expect(invMap.get('pickFile')).toBe('dialog:pick-file')
      expect(invMap.get('detectShell')).toBe('settings:detect-shell')
      expect(invMap.get('detectProvider')).toBe('settings:detect-provider')
      expect(invMap.get('detectVscode')).toBe('settings:detect-vscode')
      expect(invMap.get('getUpdateState')).toBe('update:get-state')
      expect(invMap.get('checkForUpdates')).toBe('update:check')
      expect(invMap.get('downloadUpdate')).toBe('update:download')
      expect(invMap.get('quitAndInstallUpdate')).toBe('update:quit-and-install')
      expect(invMap.get('dismissUpdate')).toBe('update:dismiss')
      expect(invMap.get('minimizeWindow')).toBe('window:minimize')
      expect(invMap.get('maximizeWindow')).toBe('window:maximize')
      expect(invMap.get('closeWindow')).toBe('window:close')
      expect(invMap.get('isWindowMaximized')).toBe('window:is-maximized')
      expect(invMap.get('fsOpenFile')).toBe('fs:open-file')
      expect(invMap.get('shellShowItemInFolder')).toBe('shell:show-item-in-folder')
    })

    it('window.stoa type declaration exists in shared/index.d.ts', () => {
      expect(sharedTypesSource).toMatch(/stoa/)
      expect(sharedTypesSource).toMatch(/RendererApi/)
      expect(sharedTypesSource).toMatch(/stoaElectron/)
      expect(sharedTypesSource).toMatch(/declare\s+global/)
    })

    it('IPC_CHANNELS defines update bridge constants with expected channel names', () => {
      const constants = extractChannelConstants(channelsSource)

      expect(constants.get('updateGetState')).toBe('update:get-state')
      expect(constants.get('updateCheck')).toBe('update:check')
      expect(constants.get('updateDownload')).toBe('update:download')
      expect(constants.get('updateQuitAndInstall')).toBe('update:quit-and-install')
      expect(constants.get('updateDismiss')).toBe('update:dismiss')
      expect(constants.get('updateState')).toBe('update:state')
      expect(constants.get('workspaceOpen')).toBe('workspace:open')
      expect(constants.get('memoryNotification')).toBe('memory:notification')
      expect(constants.get('sessionBinaryInput')).toBe('session:binary-input')
      expect(constants.get('titleGenerationNotification')).toBe('title-generation:notification')
      expect(constants.get('sessionGraphEvent')).toBe('session:graph-event')
      expect(constants.has('metaSessionBootstrap')).toBe(false)
      expect(constants.has('metaSessionEvent')).toBe(false)
    })

    it('IPC_CHANNELS defines sidebar and filesystem channel constants with expected names', () => {
      const constants = extractChannelConstants(channelsSource)

      expect(constants.get('sidebarGetState')).toBe('sidebar:get-state')
      expect(constants.get('sidebarSetState')).toBe('sidebar:set-state')
      expect(constants.get('fsReadDir')).toBe('fs:read-dir')
      expect(constants.get('fsReadFile')).toBe('fs:read-file')
      expect(constants.get('fsWriteFile')).toBe('fs:write-file')
      expect(constants.get('fsCreate')).toBe('fs:create')
      expect(constants.get('fsRename')).toBe('fs:rename')
      expect(constants.get('fsDelete')).toBe('fs:delete')
      expect(constants.get('fsSearch')).toBe('fs:search')
      expect(constants.get('fsOpenFile')).toBe('fs:open-file')
      expect(constants.get('fsChanged')).toBe('fs:changed')
      expect(constants.get('shellShowItemInFolder')).toBe('shell:show-item-in-folder')
    })

    it('IPC_CHANNELS defines git channel constants with expected names', () => {
      const constants = extractChannelConstants(channelsSource)

      expect(constants.get('gitStatus')).toBe('git:status')
      expect(constants.get('gitStage')).toBe('git:stage')
      expect(constants.get('gitUnstage')).toBe('git:unstage')
      expect(constants.get('gitDiscard')).toBe('git:discard')
      expect(constants.get('gitCommit')).toBe('git:commit')
      expect(constants.get('gitPush')).toBe('git:push')
      expect(constants.get('gitPull')).toBe('git:pull')
      expect(constants.get('gitFetch')).toBe('git:fetch')
      expect(constants.get('gitRebase')).toBe('git:rebase')
      expect(constants.get('gitMerge')).toBe('git:merge')
      expect(constants.get('gitBranches')).toBe('git:branches')
      expect(constants.get('gitLog')).toBe('git:log')
      expect(constants.get('gitDiff')).toBe('git:diff')
      expect(constants.get('gitCheckout')).toBe('git:checkout')
      expect(constants.get('gitCreateBranch')).toBe('git:create-branch')
    })
  })

  describe('Push channel registration', () => {
    it('desktop renderer bootstrap composes window.stoa from SR adapter plus native preload bridge', () => {
      expect(desktopBootstrapSource).toMatch(/window\.stoaElectron/)
      expect(desktopBootstrapSource).toMatch(/window\.stoaElectron is missing/)
      expect(desktopBootstrapSource).toMatch(/Stoa Server is unavailable/)
      expect(desktopBootstrapSource).toMatch(/new StoaClientPreloadAdapter/)
      expect(desktopBootstrapSource).toMatch(/Object\.assign\(adapter,\s*nativeBridge\)/)
      expect(desktopBootstrapSource).toMatch(/window\.stoa = adapter/)
    })

    it('main process uses webContents.send for update state', () => {
      expect(mainSource).toMatch(/webContents\.send\(\s*IPC_CHANNELS\.updateState/)
    })

    it('main process uses webContents.send for title generation notifications', () => {
      expect(mainSource).toMatch(/webContents\.send\(\s*IPC_CHANNELS\.titleGenerationNotification/)
    })

    it('main process does not wire memory notifications while memory integration is disabled', () => {
      expect(mainSource).not.toMatch(/webContents\.send\(\s*IPC_CHANNELS\.memoryNotification/)
      expect(mainSource).toMatch(/captureEvidence\s*:\s*false/)
    })

    it('activate path resends the latest update state after recreating the window', () => {
      expect(mainSource).toMatch(/app\.on\('activate'[\s\S]*mainWindow\s*=\s*createMainWindow\(\)[\s\S]*(syncUpdateStateToWindow|pushUpdateState)/)
    })

    it('main process uses webContents.send for terminal data', () => {
      expect(controllerSource).toMatch(/webContents\.send\(\s*IPC_CHANNELS\.terminalData/)
    })
  })
})
