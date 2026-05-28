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

    it('meta-session archive and restore helpers reset the session input router before changing runtime state', () => {
      const archiveBody = extractNamedFunctionBody(mainSource, 'archiveMetaSessionWithRuntime')
      const restoreBody = extractNamedFunctionBody(mainSource, 'restoreMetaSessionWithRuntime')

      expect(archiveBody, 'Could not find archiveMetaSessionWithRuntime').not.toBeNull()
      expect(restoreBody, 'Could not find restoreMetaSessionWithRuntime').not.toBeNull()
      expect(archiveBody!).toMatch(/sessionInputRouter\?\.resetSession\(sessionId\)/)
      expect(restoreBody!).toMatch(/sessionInputRouter\?\.resetSession\(sessionId\)/)
    })

    it('meta-session bootstrap prompt is imported from shared module', () => {
      expect(mainSource).toMatch(/META_SESSION_BOOTSTRAP_PROMPT/)
      expect(mainSource).toContain("from '@core/meta-session-bootstrap-prompt'")

      const bootstrapBody = extractNamedFunctionBody(mainSource, 'buildMetaSessionBootstrapPrompt')
      expect(bootstrapBody, 'Could not find buildMetaSessionBootstrapPrompt').not.toBeNull()
      expect(bootstrapBody!).toContain('return META_SESSION_BOOTSTRAP_PROMPT')
    })

    it('shared bootstrap prompt module enforces content-over-metadata rule', async () => {
      const promptModule = await import('@core/meta-session-bootstrap-prompt')
      const prompt = promptModule.META_SESSION_BOOTSTRAP_PROMPT as string

      expect(prompt).toContain('METADATA IS NOT CONTENT')
      expect(prompt).toContain('stoa-ctl work-sessions context <id> --level slim')
      expect(prompt).toContain('stoa-ctl work-sessions context <id> --level full')
      expect(prompt).toContain('stoa-ctl work-sessions send-keys <id> ...')
      expect(prompt).toContain('fetch context for EVERY relevant session before answering')
      expect(prompt).toContain('Always trust content over status')
    })

    it('wires work-session lifecycle control routes to host-owned create and archive flows', () => {
      expect(mainSource).toMatch(/workSessionLifecycle\s*:\s*\{/)
      expect(mainSource).toMatch(/createWorkSessionWithRuntime/)
      expect(mainSource).toMatch(/archiveWorkSessionWithRuntime/)
      expect(mainSource).toMatch(/await ptyHost\.killAndWait\(sessionId\)/)
      expect(mainSource).toMatch(/await projectSessionManager\.archiveSession\(sessionId\)/)
    })

    it('initializes ctlSecret before the shared webhook server starts', () => {
      const ctlSecretIndex = mainSource.indexOf('const metaSessionCtlSecret = generateSecret()')
      const bridgeStartIndex = mainSource.indexOf('const webhookPort = await sessionEventBridge.start()')

      expect(ctlSecretIndex, 'Could not find ctlSecret initialization in main/index.ts').toBeGreaterThan(-1)
      expect(bridgeStartIndex, 'Could not find shared webhook server startup in main/index.ts').toBeGreaterThan(-1)
      expect(ctlSecretIndex).toBeLessThan(bridgeStartIndex)
      expect(mainSource).toContain('ctlSecret: metaSessionCtlSecret')
    })
  })

  describe('IPC handler registration completeness', () => {
    it('every invoke RendererApi method has a corresponding ipcMain.handle registration', () => {
      const rendererApiMethods = extractRendererApiMethods(projectSessionSource)
      const channelToConstant = new Map<string, string>([
        ['getBootstrapState', 'projectBootstrap'],
        ['createProject', 'projectCreate'],
        ['deleteProject', 'projectDelete'],
        ['deleteProject', 'projectDelete'],
        ['createSession', 'sessionCreate'],
        ['openWorkspace', 'workspaceOpen'],
        ['setActiveProject', 'projectSetActive'],
        ['setActiveSession', 'sessionSetActive'],
        ['getSessionPresence', 'observabilityGetSessionPresence'],
        ['getProjectObservability', 'observabilityGetProject'],
        ['getAppObservability', 'observabilityGetApp'],
        ['listSessionObservationEvents', 'observabilityListSessionEvents'],
        ['getTerminalReplay', 'sessionTerminalReplay'],
        ['sendSessionResize', 'sessionResize'],
        ['archiveSession', 'sessionArchive'],
        ['regenerateSessionTitle', 'sessionRegenerateTitle'],
        ['restoreSession', 'sessionRestore'],
        ['restartSession', 'sessionRestart'],
        ['listArchivedSessions', 'sessionListArchived'],
        ['getMetaSessionBootstrapState', 'metaSessionBootstrap'],
        ['createMetaSession', 'metaSessionCreate'],
        ['setActiveMetaSession', 'metaSessionSetActive'],
        ['archiveMetaSession', 'metaSessionArchive'],
        ['restoreMetaSession', 'metaSessionRestore'],
        ['listMetaSessionProposals', 'metaSessionProposalList'],
        ['getMetaSessionProposal', 'metaSessionProposalGet'],
        ['approveMetaSessionProposal', 'metaSessionProposalApprove'],
        ['rejectMetaSessionProposal', 'metaSessionProposalReject'],
        ['dispatchMetaSessionProposal', 'metaSessionProposalDispatch'],
        ['setMetaSessionInspectorTarget', 'metaSessionInspectorSetTarget'],
        ['getSettings', 'settingsGet'],
        ['setSetting', 'settingsSet'],
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
        ['uninstallSidecars', 'sidecarUninstall'],
        ['listSessionEvidence', 'evidenceListSessionSnapshots'],
        ['contextExportFullText', 'contextExportFullText'],
        ['contextExportSlimText', 'contextExportSlimText']
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

    it('send-only RendererApi methods have a corresponding ipcMain.on registration', () => {
      const sendMethods = new Map<string, string>([
        ['sendSessionInput', 'sessionInput'],
        ['sendSessionBinaryInput', 'sessionBinaryInput']
      ])

      for (const [method, constantName] of sendMethods) {
        const pattern = new RegExp(
          `ipcMain\\.on\\(\\s*IPC_CHANNELS\\.${constantName}\\b`
        )
        expect(
          mainSource,
          `Missing ipcMain.on(IPC_CHANNELS.${constantName}) for send-only method "${method}"`
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
  })

  describe('Preload type contract completeness', () => {
    it('preload api object implements all current invoke RendererApi methods', () => {
      const knownInvokeMethods = [
        'getBootstrapState',
        'createProject',
        'deleteProject',
        'createSession',
        'openWorkspace',
        'setActiveProject',
        'setActiveSession',
        'getSessionPresence',
        'getProjectObservability',
        'getAppObservability',
        'listSessionObservationEvents',
        'getTerminalReplay',
        'sendSessionResize',
        'getSettings',
        'setSetting',
        'titleGenerationFetchModels',
        'pickFolder',
        'pickFile',
        'detectShell',
        'detectProvider',
        'detectVscode',
        'archiveSession',
        'regenerateSessionTitle',
        'restoreSession',
        'restartSession',
        'listArchivedSessions',
        'getMetaSessionBootstrapState',
        'createMetaSession',
        'setActiveMetaSession',
        'archiveMetaSession',
        'restoreMetaSession',
        'listMetaSessionProposals',
        'getMetaSessionProposal',
        'approveMetaSessionProposal',
        'rejectMetaSessionProposal',
        'dispatchMetaSessionProposal',
        'setMetaSessionInspectorTarget',
        'getUpdateState',
        'checkForUpdates',
        'downloadUpdate',
        'quitAndInstallUpdate',
        'dismissUpdate',
        'uninstallSidecars',
        'listSessionEvidence',
        'contextExportFullText',
        'contextExportSlimText',
        'minimizeWindow',
        'maximizeWindow',
        'closeWindow',
        'isWindowMaximized',
        'getSidebarState',
        'setSidebarState',
        'fsReadDir',
        'fsReadFile',
        'fsWriteFile',
        'fsCreate',
        'fsRename',
        'fsDelete',
        'fsSearch',
        'gitStatus',
        'gitStage',
        'gitUnstage',
        'gitDiscard',
        'gitCommit',
        'gitPush',
        'gitPull',
        'gitFetch',
        'gitRebase',
        'gitMerge',
        'gitBranches',
        'gitLog',
        'gitDiff',
        'gitCheckout',
        'gitCreateBranch'
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
    })

    it('preload api object implements send-only RendererApi methods', () => {
      const knownSendMethods = ['sendSessionInput', 'sendSessionBinaryInput']

      for (const method of knownSendMethods) {
        expect(
          preloadSource,
          `Preload is missing send method "${method}"`
        ).toMatch(new RegExp(`${method}\\s*\\(.*\\)\\s*\\{`))
        expect(
          preloadSource,
          `Send method "${method}" should use ipcRenderer.send`
        ).toMatch(new RegExp(`ipcRenderer\\.send\\(\\s*IPC_CHANNELS\\.\\w+`))
      }
    })

    it('preload uses correct channel name for each method', () => {
      const invocations = extractPreloadChannelInvokes(preloadSource)
      const constants = extractChannelConstants(channelsSource)
      const invMap = new Map(
        invocations.map(({ method, channel }) => [method, resolveChannelReference(channel, constants)])
      )

      expect(invMap.get('getBootstrapState')).toBe('project:bootstrap')
      expect(invMap.get('createProject')).toBe('project:create')
      expect(invMap.get('deleteProject')).toBe('project:delete')
      expect(invMap.get('createSession')).toBe('session:create')
      expect(invMap.get('deleteProject')).toBe('project:delete')
      expect(invMap.get('openWorkspace')).toBe('workspace:open')
      expect(invMap.get('setActiveProject')).toBe('project:set-active')
      expect(invMap.get('setActiveSession')).toBe('session:set-active')
      expect(invMap.get('getSessionPresence')).toBe('observability:get-session-presence')
      expect(invMap.get('getProjectObservability')).toBe('observability:get-project-observability')
      expect(invMap.get('getAppObservability')).toBe('observability:get-app-observability')
      expect(invMap.get('listSessionObservationEvents')).toBe('observability:list-session-events')
      expect(invMap.get('getTerminalReplay')).toBe('session:terminal-replay')
      expect(invMap.get('sendSessionResize')).toBe('session:resize')
      expect(invMap.get('getSettings')).toBe('settings:get')
      expect(invMap.get('setSetting')).toBe('settings:set')
      expect(invMap.get('titleGenerationFetchModels')).toBe('settings:title-generation-fetch-models')
      expect(invMap.get('pickFolder')).toBe('dialog:pick-folder')
      expect(invMap.get('pickFile')).toBe('dialog:pick-file')
      expect(invMap.get('detectShell')).toBe('settings:detect-shell')
      expect(invMap.get('detectProvider')).toBe('settings:detect-provider')
      expect(invMap.get('detectVscode')).toBe('settings:detect-vscode')
      expect(invMap.get('archiveSession')).toBe('session:archive')
      expect(invMap.get('regenerateSessionTitle')).toBe('session:regenerate-title')
      expect(invMap.get('restoreSession')).toBe('session:restore')
      expect(invMap.get('restartSession')).toBe('session:restart')
      expect(invMap.get('listArchivedSessions')).toBe('session:list-archived')
      expect(invMap.get('getMetaSessionBootstrapState')).toBe('meta-session:bootstrap')
      expect(invMap.get('createMetaSession')).toBe('meta-session:create')
      expect(invMap.get('setActiveMetaSession')).toBe('meta-session:set-active')
      expect(invMap.get('archiveMetaSession')).toBe('meta-session:archive')
      expect(invMap.get('restoreMetaSession')).toBe('meta-session:restore')
      expect(invMap.get('listMetaSessionProposals')).toBe('meta-session:proposal-list')
      expect(invMap.get('getMetaSessionProposal')).toBe('meta-session:proposal-get')
      expect(invMap.get('approveMetaSessionProposal')).toBe('meta-session:proposal-approve')
      expect(invMap.get('rejectMetaSessionProposal')).toBe('meta-session:proposal-reject')
      expect(invMap.get('dispatchMetaSessionProposal')).toBe('meta-session:proposal-dispatch')
      expect(invMap.get('setMetaSessionInspectorTarget')).toBe('meta-session:inspector-set-target')
      expect(invMap.get('getUpdateState')).toBe('update:get-state')
      expect(invMap.get('checkForUpdates')).toBe('update:check')
      expect(invMap.get('downloadUpdate')).toBe('update:download')
      expect(invMap.get('quitAndInstallUpdate')).toBe('update:quit-and-install')
      expect(invMap.get('dismissUpdate')).toBe('update:dismiss')
      expect(invMap.get('uninstallSidecars')).toBe('sidecar:uninstall')
      expect(invMap.get('listSessionEvidence')).toBe('evidence:list-session-snapshots')
      expect(invMap.get('contextExportFullText')).toBe('context:export-full-text')
      expect(invMap.get('contextExportSlimText')).toBe('context:export-slim-text')
    })

    it('preload send-only methods use correct channel names', () => {
      expect(preloadSource).toMatch(/sendSessionInput[\s\S]*ipcRenderer\.send\(\s*IPC_CHANNELS\.sessionInput/)
      expect(preloadSource).toMatch(/sendSessionBinaryInput[\s\S]*ipcRenderer\.send\(\s*IPC_CHANNELS\.sessionBinaryInput/)
    })

    it('window.stoa type declaration exists in shared/index.d.ts', () => {
      expect(sharedTypesSource).toMatch(/stoa/)
      expect(sharedTypesSource).toMatch(/RendererApi/)
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
    })
  })

  describe('Push channel registration', () => {
    it('preload registers listener for terminal:data channel', () => {
      expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*IPC_CHANNELS\.terminalData/)
    })

    it('preload registers listener for observability push channels', () => {
      expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*IPC_CHANNELS\.observabilitySessionPresenceChanged/)
      expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*IPC_CHANNELS\.observabilityProjectChanged/)
      expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*IPC_CHANNELS\.observabilityAppChanged/)
    })

    it('preload registers listener for update:state channel', () => {
      expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*IPC_CHANNELS\.updateState/)
    })

    it('preload registers listener for meta-session:event channel', () => {
      expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*IPC_CHANNELS\.metaSessionEvent/)
    })

    it('preload registers listener for memory:notification channel', () => {
      expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*IPC_CHANNELS\.memoryNotification/)
    })

    it('preload registers listener for title-generation:notification channel', () => {
      expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*IPC_CHANNELS\.titleGenerationNotification/)
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
