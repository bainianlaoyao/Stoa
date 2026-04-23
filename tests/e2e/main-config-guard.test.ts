import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')

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

    it('preload path in main/index.ts ends with .mjs extension', () => {
      expect(mainSource).toMatch(/preload[/'"]+index\.mjs['"]\)/)
    })
  })

  describe('Provider routing guard', () => {
    it('main/index.ts does not hardcode shell/opencode provider ternary routing anymore', () => {
      expect(mainSource).not.toContain("session.type === 'shell' ? 'local-shell' : 'opencode'")
    })
  })

  describe('IPC handler registration completeness', () => {
    it('every RendererApi method has a corresponding ipcMain.handle registration', () => {
      const rendererApiMethods = extractRendererApiMethods(projectSessionSource)
      const channelToConstant = new Map<string, string>([
        ['getBootstrapState', 'projectBootstrap'],
        ['createProject', 'projectCreate'],
        ['createSession', 'sessionCreate'],
        ['setActiveProject', 'projectSetActive'],
        ['setActiveSession', 'sessionSetActive'],
        ['getTerminalReplay', 'sessionTerminalReplay'],
        ['sendSessionInput', 'sessionInput'],
        ['sendSessionResize', 'sessionResize'],
        ['getSettings', 'settingsGet'],
        ['setSetting', 'settingsSet'],
        ['pickFolder', 'dialogPickFolder'],
        ['pickFile', 'dialogPickFile'],
        ['detectShell', 'settingsDetectShell'],
        ['detectProvider', 'settingsDetectProvider']
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
        const channelStr = channel.replace(/['"]/g, '')
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
      expect(matches!.length).toBeGreaterThanOrEqual(13)
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
      expect(match![1]).toMatch(/createSession/)
    })

    it('IPC handler for project:bootstrap calls snapshot', () => {
      const handlerPattern = /ipcMain\.handle\([^)]*projectBootstrap[^,]*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?([^}]*\})/s
      const match = mainSource.match(handlerPattern)
      expect(match, 'Could not find handler for projectBootstrap').not.toBeNull()
      expect(match![1]).toMatch(/snapshot/)
    })
  })

  describe('Preload type contract completeness', () => {
    it('preload api object implements all current invoke RendererApi methods', () => {
      const knownInvokeMethods = [
        'getBootstrapState',
        'createProject',
        'createSession',
        'setActiveProject',
        'setActiveSession',
        'getTerminalReplay',
        'sendSessionInput',
        'sendSessionResize',
        'getSettings',
        'setSetting',
        'pickFolder',
        'pickFile',
        'detectShell',
        'detectProvider',
        'archiveSession',
        'restoreSession',
        'listArchivedSessions',
        'minimizeWindow',
        'maximizeWindow',
        'closeWindow'
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

    it('preload uses correct channel name for each method', () => {
      const invocations = extractPreloadChannelInvokes(preloadSource)
      const invMap = new Map(invocations.map(({ method, channel }) => [method, channel.replace(/['"]/g, '')]))

      expect(invMap.get('getBootstrapState')).toBe('project:bootstrap')
      expect(invMap.get('createProject')).toBe('project:create')
      expect(invMap.get('createSession')).toBe('session:create')
      expect(invMap.get('setActiveProject')).toBe('project:set-active')
      expect(invMap.get('setActiveSession')).toBe('session:set-active')
      expect(invMap.get('getTerminalReplay')).toBe('session:terminal-replay')
      expect(invMap.get('sendSessionInput')).toBe('session:input')
      expect(invMap.get('sendSessionResize')).toBe('session:resize')
      expect(invMap.get('getSettings')).toBe('settings:get')
      expect(invMap.get('setSetting')).toBe('settings:set')
      expect(invMap.get('pickFolder')).toBe('dialog:pick-folder')
      expect(invMap.get('pickFile')).toBe('dialog:pick-file')
      expect(invMap.get('detectShell')).toBe('settings:detect-shell')
      expect(invMap.get('detectProvider')).toBe('settings:detect-provider')
      expect(invMap.get('archiveSession')).toBe('session:archive')
      expect(invMap.get('restoreSession')).toBe('session:restore')
      expect(invMap.get('listArchivedSessions')).toBe('session:list-archived')
    })

    it('window.stoa type declaration exists in shared/index.d.ts', () => {
      expect(sharedTypesSource).toMatch(/stoa/)
      expect(sharedTypesSource).toMatch(/RendererApi/)
      expect(sharedTypesSource).toMatch(/declare\s+global/)
    })
  })

  describe('Push channel registration', () => {
    it('preload registers listener for terminal:data channel', () => {
      expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*['"]terminal:data['"]/)
    })

    it('preload registers listener for session:event channel', () => {
      expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*['"]session:event['"]/)
    })

    it('main process uses webContents.send for terminal data', () => {
      expect(controllerSource).toMatch(/webContents\.send\(\s*IPC_CHANNELS\.terminalData/)
    })

    it('main process uses webContents.send for session events', () => {
      expect(controllerSource).toMatch(/webContents\.send\(\s*IPC_CHANNELS\.sessionEvent/)
    })
  })
})
