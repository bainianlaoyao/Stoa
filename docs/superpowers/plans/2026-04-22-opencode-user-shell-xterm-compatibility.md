# OpenCode User Shell And Xterm Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch OpenCode through the user's configured shell so runtime semantics match normal terminal usage, and harden xterm.js for the strongest practical Windows/Linux/macOS compatibility without regressing session replay/switching.

**Architecture:** Keep provider command construction semantic and move shell-specific spawning into a dedicated runtime helper so OpenCode can be executed through PowerShell/cmd/bash/zsh/sh consistently. Make provider detection shell-aware as well, so settings detection and actual runtime launch resolve the same executable semantics. For xterm, centralize platform options and addon loading in a helper that enables Windows PTY heuristics, loads every currently available addon package (`fit`, `unicode11`, `web-links`, `webgl`), and degrades safely when GPU/WebGL features are unavailable.

**Tech Stack:** Electron, Vue 3, Pinia, node-pty, xterm.js, Vitest, PowerShell/cmd/bash/zsh shell invocation

---

## File Structure

- **Create:** `src/core/shell-command.ts`
  - Shell-family detection, command quoting, and PTY-safe wrapper command generation for PowerShell/cmd/POSIX shells.
- **Create/Test:** `src/core/shell-command.test.ts`
  - Unit coverage for shell-family classification and wrapped spawn arguments.
- **Create/Test:** `src/core/settings-detector.test.ts`
  - Shell-aware provider detection tests so auto-detection matches runtime semantics.
- **Modify:** `src/core/settings-detector.ts`
  - Detect providers via the active shell family instead of hardcoded `where`/`which` semantics only.
- **Modify:** `src/shared/project-session.ts`
  - Extend provider runtime context to carry resolved provider path when present.
- **Modify:** `src/extensions/providers/opencode-provider.ts`
  - Stop hardcoding `opencode.cmd`; use the configured provider path when available and otherwise keep the semantic command name `opencode`.
- **Modify/Test:** `src/extensions/providers/opencode-provider.test.ts`
  - Verify configured-path and fallback semantic command behavior.
- **Modify:** `src/core/session-runtime.ts`
  - Wrap OpenCode commands through the configured shell before calling `node-pty`.
- **Modify/Test:** `src/core/session-runtime.test.ts`
  - Verify OpenCode uses shell-wrapped spawning while shell sessions remain direct.
- **Modify/Test:** `src/core/session-runtime-callbacks.test.ts`
  - Keep callback/lifecycle behavior correct under wrapped commands.
- **Modify:** `src/main/index.ts`
  - Resolve shell/provider paths from persisted settings or detector fallbacks and pass them into session startup and provider detection IPC.
- **Modify/Test:** `tests/e2e/provider-integration.test.ts`
  - Verify provider commands and sidecar output under shell-aware runtime context.
- **Modify/Test:** `tests/e2e/backend-lifecycle.test.ts`
  - Verify main/runtime integration uses user-shell launch semantics for OpenCode.
- **Modify:** `package.json`
  - Declare direct xterm addon dependencies that are now used by source code.
- **Create:** `src/renderer/terminal/xterm-runtime.ts`
  - Platform-aware terminal options and addon-loading helper with safe WebGL fallback.
- **Create/Test:** `src/renderer/terminal/xterm-runtime.test.ts`
  - Unit coverage for platform options, addon loading, and WebGL failure fallback.
- **Modify:** `src/renderer/components/TerminalViewport.vue`
  - Replace inline terminal construction with the compatibility helper and keep existing mount/replay safety.
- **Modify/Test:** `src/renderer/components/TerminalViewport.test.ts`
  - Verify the live viewport still works with the new helper and compatibility features enabled.

## Constraints

- OpenCode sessions must launch through the configured user shell when a shell path is available.
- The runtime must still work before the user visits settings: if `settings.shellPath` or `settings.providers.opencode` is empty, resolve fallbacks in the main process.
- Shell sessions remain direct shell PTY sessions and must not be wrapped through an extra shell layer.
- Xterm compatibility work must not reintroduce stale replay writes, session-switch breakage, or black-screen regressions.
- Do not add migration or compatibility shims for old contracts beyond the minimum needed to keep the app building; this repository accepts breaking changes during prototyping.
- Final verification gate is `npx vitest run` with zero unexpected failures.

---

### Task 1: Make Provider Detection Match The User Shell

**Files:**
- Create: `src/core/settings-detector.test.ts`
- Modify: `src/core/settings-detector.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/settings-detector.test.ts
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { execFile } from 'node:child_process'
import { detectProvider } from './settings-detector'

vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}))

describe('detectProvider', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset()
  })

  test('uses PowerShell Get-Command when the configured shell is powershell', async () => {
    vi.mocked(execFile).mockImplementation((_file, _args, cb) => {
      cb?.(null, 'C:\\Users\\30280\\AppData\\Roaming\\npm\\opencode.ps1\n', '')
      return {} as never
    })

    const detected = await detectProvider(
      'opencode',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    )

    expect(execFile).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        expect.stringContaining('Get-Command opencode')
      ],
      expect.any(Function)
    )
    expect(detected).toBe('C:\\Users\\30280\\AppData\\Roaming\\npm\\opencode.ps1')
  })

  test('uses POSIX shell command -lc when the configured shell is bash', async () => {
    vi.mocked(execFile).mockImplementation((_file, _args, cb) => {
      cb?.(null, '/usr/local/bin/opencode\n', '')
      return {} as never
    })

    const detected = await detectProvider('opencode', '/bin/bash')

    expect(execFile).toHaveBeenCalledWith(
      '/bin/bash',
      ['-lc', 'command -v opencode'],
      expect.any(Function)
    )
    expect(detected).toBe('/usr/local/bin/opencode')
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/core/settings-detector.test.ts`

Expected: FAIL because `detectProvider()` currently only uses hardcoded `where`/`which` behavior and cannot align with the configured shell.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/core/settings-detector.ts
function getShellFamily(shellPath: string | null | undefined): 'powershell' | 'cmd' | 'posix' | 'unknown' {
  const normalized = (shellPath ?? '').toLowerCase()
  if (normalized.endsWith('pwsh') || normalized.endsWith('pwsh.exe') || normalized.endsWith('powershell.exe')) {
    return 'powershell'
  }
  if (normalized.endsWith('cmd') || normalized.endsWith('cmd.exe')) {
    return 'cmd'
  }
  if (normalized.includes('/bash') || normalized.includes('/zsh') || normalized.includes('/sh')) {
    return 'posix'
  }
  return 'unknown'
}

export async function detectProvider(providerId: string, shellPath?: string | null): Promise<string | null> {
  const shellFamily = getShellFamily(shellPath)

  if (shellFamily === 'powershell' && shellPath) {
    return new Promise<string | null>((resolve) => {
      execFile(
        shellPath,
        [
          '-NoLogo',
          '-NoProfile',
          '-Command',
          `(Get-Command ${providerId} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)`
        ],
        (err, stdout) => {
          if (err) {
            resolve(null)
            return
          }
          resolve(stdout.trim() || null)
        }
      )
    })
  }

  if (shellFamily === 'posix' && shellPath) {
    return new Promise<string | null>((resolve) => {
      execFile(shellPath, ['-lc', `command -v ${providerId}`], (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        resolve(stdout.trim() || null)
      })
    })
  }

  const cmd = process.platform === 'win32' ? 'where' : 'which'
  return new Promise<string | null>((resolve) => {
    execFile(cmd, [providerId], (err, stdout) => {
      if (err) {
        resolve(null)
        return
      }
      const firstLine = stdout.trim().split('\n')[0]?.trim()
      resolve(firstLine || null)
    })
  })
}

// src/main/index.ts
ipcMain.handle(IPC_CHANNELS.settingsDetectProvider, async (_event, providerId: string) => {
  const shellPath = projectSessionManager?.getSettings().shellPath ?? null
  return detectProvider(providerId, shellPath)
})
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npx vitest run src/core/settings-detector.test.ts`

Expected: PASS. Provider auto-detection now resolves through the same shell family that runtime launch will use.

- [ ] **Step 5: Commit**

```bash
git add src/core/settings-detector.ts src/core/settings-detector.test.ts src/main/index.ts
git commit -m "fix: make provider detection shell-aware"
```

---

### Task 2: Launch OpenCode Through The User Shell

**Files:**
- Create: `src/core/shell-command.ts`
- Create: `src/core/shell-command.test.ts`
- Modify: `src/shared/project-session.ts`
- Modify: `src/extensions/providers/opencode-provider.ts`
- Modify: `src/extensions/providers/opencode-provider.test.ts`
- Modify: `src/core/session-runtime.ts`
- Modify: `src/core/session-runtime.test.ts`
- Modify: `src/core/session-runtime-callbacks.test.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/e2e/provider-integration.test.ts`
- Modify: `tests/e2e/backend-lifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/shell-command.test.ts
import { describe, expect, test } from 'vitest'
import { wrapCommandForShell } from './shell-command'

describe('wrapCommandForShell', () => {
  test('wraps opencode through PowerShell command mode', () => {
    const wrapped = wrapCommandForShell(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      {
        command: 'opencode',
        args: ['--pure'],
        cwd: 'D:/demo',
        env: { PATH: 'x' }
      }
    )

    expect(wrapped.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(wrapped.args[0]).toBe('-NoLogo')
    expect(wrapped.args[1]).toBe('-Command')
    expect(wrapped.args[2]).toContain('opencode')
    expect(wrapped.args[2]).toContain('--pure')
  })

  test('wraps opencode through bash -lc on POSIX shells', () => {
    const wrapped = wrapCommandForShell('/bin/bash', {
      command: 'opencode',
      args: ['--pure', '--session', 'ext-123'],
      cwd: '/tmp/demo',
      env: { PATH: 'x' }
    })

    expect(wrapped.command).toBe('/bin/bash')
    expect(wrapped.args).toEqual(['-lc', expect.stringContaining('exec opencode --pure --session ext-123')])
  })
})

// src/core/session-runtime.test.ts
test('opencode sessions spawn through the configured user shell', async () => {
  const ptyHost = { start: vi.fn(() => ({ runtimeId: 'session_op_1' })) }
  const provider = createProviderStub({
    buildStartCommand: vi.fn(async () => ({
      command: 'opencode',
      args: ['--pure'],
      cwd: 'D:/demo',
      env: { PATH: 'x' }
    }))
  })

  await startSessionRuntime({
    session: createBaseSession({ id: 'session_op_1', type: 'opencode' }),
    webhookPort: 43127,
    provider,
    ptyHost,
    manager: createManagerSpy(),
    shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    providerPath: null
  })

  expect(ptyHost.start).toHaveBeenCalledWith(
    'session_op_1',
    expect.objectContaining({
      command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    }),
    expect.any(Function),
    expect.any(Function)
  )
})

// src/extensions/providers/opencode-provider.test.ts
test('uses configured provider path when one is supplied', async () => {
  const provider = createOpenCodeProvider()
  const command = await provider.buildStartCommand(createTarget(), {
    webhookPort: 43127,
    sessionSecret: 'secret',
    providerPort: 43128,
    providerPath: 'C:\\Users\\30280\\AppData\\Roaming\\npm\\opencode.ps1'
  })

  expect(command.command).toBe('C:\\Users\\30280\\AppData\\Roaming\\npm\\opencode.ps1')
  expect(command.args).toEqual(['--pure'])
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/core/shell-command.test.ts src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts src/extensions/providers/opencode-provider.test.ts`

Expected: FAIL because there is no shell wrapping helper, `startSessionRuntime()` still starts OpenCode directly, and the provider still hardcodes Windows-specific command names.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/shared/project-session.ts
export interface ProviderCommandContext {
  webhookPort: number
  sessionSecret: string
  providerPort: number
  providerPath?: string | null
}

// src/extensions/providers/opencode-provider.ts
function opencodeCommand(context: ProviderCommandContext): string {
  return context.providerPath?.trim() || 'opencode'
}

function createCommand(
  target: ProviderRuntimeTarget,
  context: ProviderCommandContext,
  args: string[]
): ProviderCommand {
  return {
    command: opencodeCommand(context),
    args,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}

// src/core/shell-command.ts
import type { ProviderCommand } from '@shared/project-session'

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`
}

export function wrapCommandForShell(shellPath: string, command: ProviderCommand): ProviderCommand {
  const normalized = shellPath.toLowerCase()
  if (normalized.endsWith('powershell.exe') || normalized.endsWith('pwsh.exe') || normalized.endsWith('pwsh')) {
    const rendered = [command.command, ...command.args].map(quotePowerShell).join(' ')
    return {
      command: shellPath,
      args: ['-NoLogo', '-Command', `& ${rendered}`],
      cwd: command.cwd,
      env: command.env
    }
  }

  if (normalized.endsWith('cmd.exe') || normalized.endsWith('cmd')) {
    const rendered = [command.command, ...command.args].join(' ')
    return {
      command: shellPath,
      args: ['/d', '/s', '/c', rendered],
      cwd: command.cwd,
      env: command.env
    }
  }

  const rendered = [command.command, ...command.args].map(quotePosix).join(' ')
  return {
    command: shellPath,
    args: ['-lc', `exec ${rendered}`],
    cwd: command.cwd,
    env: command.env
  }
}

// src/core/session-runtime.ts
const context = {
  webhookPort,
  sessionSecret,
  providerPort,
  providerPath: options.providerPath ?? null
}

const baseCommand = canResume
  ? await provider.buildResumeCommand(target, session.externalSessionId!, context)
  : await provider.buildStartCommand(target, context)

const spawnCommand =
  session.type === 'opencode' && options.shellPath
    ? wrapCommandForShell(options.shellPath, baseCommand)
    : baseCommand

const started = ptyHost.start(session.id, spawnCommand, onData, onExit)

// src/main/index.ts
const settings = projectSessionManager.getSettings()
const shellPath = settings.shellPath || await detectShell()
const providerPath =
  session.type === 'opencode'
    ? settings.providers.opencode || await detectProvider('opencode', shellPath)
    : null

void startSessionRuntime({
  session: { ... },
  webhookPort,
  provider,
  ptyHost,
  manager: runtimeController,
  shellPath,
  providerPath
})
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx vitest run src/core/shell-command.test.ts src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts src/extensions/providers/opencode-provider.test.ts tests/e2e/provider-integration.test.ts tests/e2e/backend-lifecycle.test.ts`

Expected: PASS. OpenCode now launches through the user's shell, configured provider paths are respected, and shell sessions remain direct PTY shells.

- [ ] **Step 5: Commit**

```bash
git add src/core/shell-command.ts src/core/shell-command.test.ts src/shared/project-session.ts src/extensions/providers/opencode-provider.ts src/extensions/providers/opencode-provider.test.ts src/core/session-runtime.ts src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts src/main/index.ts tests/e2e/provider-integration.test.ts tests/e2e/backend-lifecycle.test.ts
git commit -m "feat: launch opencode through the user shell"
```

---

### Task 3: Build A Cross-Platform Xterm Compatibility Layer

**Files:**
- Modify: `package.json`
- Create: `src/renderer/terminal/xterm-runtime.ts`
- Create: `src/renderer/terminal/xterm-runtime.test.ts`
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/TerminalViewport.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/terminal/xterm-runtime.test.ts
import { describe, expect, test, vi } from 'vitest'
import { createTerminalRuntime } from './xterm-runtime'

vi.mock('@xterm/xterm', () => {
  class Terminal {
    options: Record<string, unknown>
    loadedAddons: unknown[] = []
    unicode = { activeVersion: '6' }
    constructor(options: Record<string, unknown>) {
      this.options = options
    }
    loadAddon(addon: unknown) {
      this.loadedAddons.push(addon)
    }
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss = vi.fn()
  }
}))

test('enables windowsPty heuristics on Windows and does not set convertEol', async () => {
  const runtime = createTerminalRuntime('win32', vi.fn())

  expect(runtime.terminal.options.windowsPty).toEqual({ backend: 'conpty' })
  expect(runtime.terminal.options.convertEol).toBeUndefined()
})

test('loads all currently available addons and activates unicode11', async () => {
  const runtime = createTerminalRuntime('linux', vi.fn())

  expect(runtime.terminal.loadedAddons).toHaveLength(4)
  expect(runtime.terminal.unicode.activeVersion).toBe('11')
})

test('swallows WebGL load failure and keeps terminal creation alive', async () => {
  const { WebglAddon } = await import('@xterm/addon-webgl')
  vi.spyOn(WebglAddon.prototype, 'constructor' as never).mockImplementationOnce(() => {
    throw new Error('webgl unavailable')
  })

  expect(() => createTerminalRuntime('darwin', vi.fn())).not.toThrow()
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/renderer/terminal/xterm-runtime.test.ts src/renderer/components/TerminalViewport.test.ts`

Expected: FAIL because there is no compatibility helper yet, `TerminalViewport.vue` still builds terminals inline, `convertEol` is still enabled, and addons beyond `FitAddon` are not loaded.

- [ ] **Step 3: Write the minimal implementation**

```ts
// package.json
"dependencies": {
  "@xterm/addon-fit": "^0.11.0",
  "@xterm/addon-unicode11": "^0.9.0",
  "@xterm/addon-web-links": "^0.12.0",
  "@xterm/addon-webgl": "^0.19.0",
  "@xterm/xterm": "^6.0.0",
  ...
}

// src/renderer/terminal/xterm-runtime.ts
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'

export function createTerminalRuntime(platform: NodeJS.Platform, openExternal: (uri: string) => void) {
  const terminal = new Terminal({
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    lineHeight: 1.5,
    theme: {
      background: 'var(--terminal-bg)',
      foreground: 'var(--terminal-text)',
      cursor: 'var(--terminal-text)',
      cursorAccent: 'var(--terminal-bg)',
      selectionBackground: 'rgba(226, 232, 240, 0.2)',
      black: '#0a0b0d',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#e2e8f0',
      brightBlack: '#64748b',
      brightRed: '#f87171',
      brightGreen: '#34d399',
      brightYellow: '#fbbf24',
      brightBlue: '#60a5fa',
      brightMagenta: '#a78bfa',
      brightCyan: '#22d3ee',
      brightWhite: '#f8fafc'
    },
    scrollback: 10_000,
    windowsPty: platform === 'win32' ? { backend: 'conpty' } : undefined
  })

  const fitAddon = new FitAddon()
  const unicodeAddon = new Unicode11Addon()
  const webLinksAddon = new WebLinksAddon((_event, uri) => openExternal(uri))

  terminal.loadAddon(fitAddon)
  terminal.loadAddon(unicodeAddon)
  terminal.unicode.activeVersion = '11'
  terminal.loadAddon(webLinksAddon)

  let webglAddon: WebglAddon | null = null
  try {
    webglAddon = new WebglAddon()
    terminal.loadAddon(webglAddon)
    webglAddon.onContextLoss(() => {
      webglAddon?.dispose()
      webglAddon = null
    })
  } catch {
    webglAddon = null
  }

  return { terminal, fitAddon, webglAddon }
}

// src/renderer/components/TerminalViewport.vue
import { createTerminalRuntime } from '@renderer/terminal/xterm-runtime'

const { terminal: localTerminal, fitAddon: localFitAddon } = createTerminalRuntime(
  window.navigator.platform.toLowerCase().includes('win') ? 'win32' :
  window.navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'linux',
  (uri) => window.open(uri, '_blank', 'noopener,noreferrer')
)
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx vitest run src/renderer/terminal/xterm-runtime.test.ts src/renderer/components/TerminalViewport.test.ts`

Expected: PASS. The viewport keeps its replay/switch safety while xterm now enables platform heuristics and every currently available addon package.

- [ ] **Step 5: Commit**

```bash
git add package.json src/renderer/terminal/xterm-runtime.ts src/renderer/terminal/xterm-runtime.test.ts src/renderer/components/TerminalViewport.vue src/renderer/components/TerminalViewport.test.ts
git commit -m "feat: add cross-platform xterm compatibility layer"
```

---

### Task 4: Run The Full Integration Gate

**Files:**
- Modify: `tests/e2e/provider-integration.test.ts`
- Modify: `tests/e2e/backend-lifecycle.test.ts`
- Modify: `src/core/session-runtime.test.ts`
- Modify: `src/renderer/components/TerminalViewport.test.ts`
- Modify: `src/renderer/terminal/xterm-runtime.test.ts`

- [ ] **Step 1: Add the final integration assertions**

```ts
// tests/e2e/provider-integration.test.ts
test('opencode buildStartCommand keeps semantic command name when no provider path is configured', async () => {
  const provider = getProvider('opencode')
  const command = await provider.buildStartCommand(createTarget({ type: 'opencode' }), createContext())

  expect(command.command).toBe('opencode')
  expect(command.args).toEqual(['--pure'])
})

// tests/e2e/backend-lifecycle.test.ts
test('main process resolves shellPath and providerPath before starting opencode runtime', async () => {
  const detectShellMock = vi.fn().mockResolvedValue('/bin/bash')
  const detectProviderMock = vi.fn().mockResolvedValue('/usr/local/bin/opencode')
  const startRuntimeMock = vi.fn().mockResolvedValue(undefined)

  await bootAppWithMocks({
    detectShell: detectShellMock,
    detectProvider: detectProviderMock,
    startSessionRuntime: startRuntimeMock
  })

  expect(detectShellMock).toHaveBeenCalled()
  expect(detectProviderMock).toHaveBeenCalledWith('opencode', '/bin/bash')
  expect(startRuntimeMock).toHaveBeenCalledWith(
    expect.objectContaining({
      shellPath: '/bin/bash',
      providerPath: '/usr/local/bin/opencode'
    })
  )
})
```

- [ ] **Step 2: Run the integration slice to verify it passes**

Run: `npx vitest run tests/e2e/provider-integration.test.ts tests/e2e/backend-lifecycle.test.ts src/core/session-runtime.test.ts src/renderer/terminal/xterm-runtime.test.ts src/renderer/components/TerminalViewport.test.ts`

Expected: PASS. Detection semantics, runtime launch semantics, and terminal compatibility are aligned.

- [ ] **Step 3: Run the full repository gate**

Run: `npx vitest run`

Expected: PASS with zero unexpected failures, satisfying the repository quality gate.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/provider-integration.test.ts tests/e2e/backend-lifecycle.test.ts src/core/session-runtime.test.ts src/renderer/terminal/xterm-runtime.test.ts src/renderer/components/TerminalViewport.test.ts
git commit -m "test: verify shell-launched opencode and xterm compatibility"
```

---

## Self-Review

### Spec coverage

- OpenCode startup semantics should match the user's shell:
  Covered by **Task 1** and **Task 2**, which align provider detection and runtime spawning on the configured shell family.
- Startup should still work before the settings UI is used:
  Covered by **Task 2**, which resolves shell/provider fallbacks in `src/main/index.ts`.
- Xterm should be as compatible as practical across Windows/Linux/macOS:
  Covered by **Task 3**, which adds a dedicated compatibility helper and loads every currently available addon package while enabling `windowsPty` heuristics on Windows.
- No regressions to terminal replay/switching:
  Covered by **Task 3** and **Task 4**, which keep `TerminalViewport` tests in the gate.

### Placeholder scan

- No `TODO`, `TBD`, or “handle this later” placeholders remain.
- Each task includes exact files, red/green commands, and concrete code direction.

### Type consistency

- `detectProvider(providerId, shellPath?)` is the canonical detector contract.
- `ProviderCommandContext.providerPath` is the only new provider input.
- `shellPath` remains a runtime/startup concern, not a provider concern.
- Xterm compatibility logic is isolated to `src/renderer/terminal/xterm-runtime.ts`; `TerminalViewport.vue` continues owning replay/subscription flow only.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-opencode-user-shell-xterm-compatibility.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
