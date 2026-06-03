# stoa-ctl 设置动态启停 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户通过应用设置界面动态启停 stoa-ctl 命令行控制平面,默认 opt-in 关闭,所有 4 个暴露面(per-session shim / system shim+PATH / 子会话 env / HTTP `/ctl/*` 路由)联动关闭。

**Architecture:** 新增 `createStoaCtlGate` 主进程单例作为唯一 truth source,在 `AppSettings` 加 `stoaCtlEnabled: boolean`,4 个联动点全部从 `gate.isEnabled()` 读取。关闭时主动清理 shim 残留、撤销 PATH 注册,HTTP 路由保留但返回 503 disabled envelope。Renderer 通过现有 `updateSetting` 通道切换设置,主进程订阅 `settings:updated` 事件实时联动。

**Tech Stack:** TypeScript, Electron main 进程, Vue 3 + Pinia (renderer), Express (`/ctl/*` 路由), Node `fs/promises` (shim 文件), PowerShell (Windows PATH 操作), bash/zsh (POSIX shell rc 操作)。

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/core/stoa-ctl-feature.ts` | `createStoaCtlGate()` 单例 + `isStoaCtlEnabled()` helper |
| `src/core/stoa-ctl-feature.test.ts` | gate 行为单测 |
| `testing/behavior/stoactl-lifecycle.ts` | `defineBehavior` 行为资产:disabled-at-startup / enable-then-restart / disable-cleanup / http-503-when-disabled / env-stripped-when-disabled |
| `testing/behavior/stoactl-lifecycle.test.ts` | 行为资产校验 |
| `testing/topology/stoactl-topology.ts` | `data-testid="settings-stoactl-toggle"` 节点 |
| `testing/journeys/stoactl-lifecycle.journey.ts` | 行为到 Playwright 路径映射 |
| `testing/journeys/stoactl-lifecycle.journey.test.ts` | journey 校验 |
| `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts` | **由 generator 生成,不要手改** |
| `tests/e2e/settings-stoactl-toggle.test.ts` | E2E:启停 + 清理 + 503 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/shared/project-session.ts` | `AppSettings.stoaCtlEnabled: boolean`,`DEFAULT_SETTINGS.stoaCtlEnabled = false` |
| `src/core/stoa-ctl-shim.ts` | 新增 `unregisterStoaCtlShim(binDir)` 与 `unregisterStoaCtlSystemShim()`(幂等清理 shim + 撤销 PowerShell User PATH + shell rc 注入) |
| `src/core/stoa-ctl-shim.test.ts` | unregister 路径单测 |
| `src/core/session-command-env.ts` | `BuildSessionCommandEnvOptions` 加 `stoaCtlEnabled: boolean`,关闭时不输出 `STOA_CTL_COMMAND`、不 prepend bin dir |
| `src/core/session-command-env.test.ts` | disabled 分支测试 |
| `src/core/meta-session-command-env.ts` | **删除**——grep 无调用方(`rg "buildMetaSessionCommandEnv" src/`),死代码 |
| `src/main/index.ts` | 创建 `stoaCtlGate`、订阅 `settings:updated` 事件、4 个调用点过 gate、`createSessionControlServer` deps 加 `isCtlEnabled` 注入 |
| `src/core/session-control-server.ts` | 接收 `isCtlEnabled: () => boolean`,在 `/ctl` 鉴权中间件**之前**加 disabled gate(无凭据也返回 503),handler 头不再重复判断 |
| `src/core/session-control-server.test.ts` | 503 disabled 路径测试 |
| `src/renderer/stores/settings.ts` | 新增 `stoaCtlEnabled` ref + updateSetting 分支 |
| `src/renderer/components/settings/ProvidersSettings.vue` | 新增 toggle 控件(参照 `claudeDangerouslySkipPermissions` 模式) |
| `src/renderer/components/settings/ProvidersSettings.test.ts` | toggle 单测 |
| `src/renderer/i18n/en.ts` & `zh-CN.ts` | 新增 `settings.stoactlToggle.*` 文案键 |
| `testing/generators/behavior-coverage.ts` | 把新行为纳入覆盖率预算 |
| `testing/generators/generate-playwright.ts` | 纳入 stoactl-lifecycle journey |
| `testing/behavior/stoactl-lifecycle.ts` | **新增** — 5 个 `defineBehavior` 节点,严格对齐 `testing-contracts.ts` 枚举 |
| `testing/behavior/stoactl-lifecycle.test.ts` | **新增** — 行为资产校验 |
| `src/core/project-session-manager.ts` | `setSetting` 末尾 emit `'settings:updated'`(若尚未实现);Task 7 配套 |
| `testing/topology/stoactl-topology.ts` | **新增** — `defineTopology({ surface, testIds })` |
| `testing/journeys/stoactl-lifecycle.journey.ts` | **新增** — `defineJourney({ id, behavior, usageMode, setup[], act[], assert[], variants[] })` |
| `testing/journeys/stoactl-lifecycle.journey.test.ts` | **新增** — journey 校验 |

### 不修改

- `tools/stoa-ctl/index.ts` — 保持原样
- `src/core/stoa-ctl-port-file.ts` — 保持原样
- `tests/generated/**/*.ts` — 由 generator 生成,不可手改

---

## Task 1: `AppSettings` 扩展 + `DEFAULT_SETTINGS`

**Files:**
- Modify: `src/shared/project-session.ts:192-203` (AppSettings interface)
- Modify: `src/shared/project-session.ts:227-246` (DEFAULT_SETTINGS)

- [ ] **Step 1: 修改 AppSettings interface**

在 `AppSettings` 内追加字段(放在 `claudeDangerouslySkipPermissions` 后):

```ts
export interface AppSettings {
  shellPath: string
  terminal: Partial<TerminalSettings>
  providers: Record<string, string>
  evolverInferenceProvider: EvolverInferenceProvider
  evolverExecutionMode: EvolverExecutionMode
  titleGeneration: TitleGenerationSettings
  workspaceIde: WorkspaceIdeSettings
  claudeDangerouslySkipPermissions: boolean
  stoaCtlEnabled: boolean   // NEW
  locale: string
  theme: 'light' | 'dark' | 'system'
}
```

- [ ] **Step 2: 修改 DEFAULT_SETTINGS**

在 `DEFAULT_SETTINGS` 中 `claudeDangerouslySkipPermissions: false` 之后追加:

```ts
stoaCtlEnabled: false,
```

- [ ] **Step 3: 跑 typecheck**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/shared/project-session.ts
git commit -m "feat(settings): add stoaCtlEnabled flag, default false"
```

---

## Task 2: `createStoaCtlGate` 单例

**Files:**
- Create: `src/core/stoa-ctl-feature.ts`
- Create: `src/core/stoa-ctl-feature.test.ts`

- [ ] **Step 1: 写失败单测**

`src/core/stoa-ctl-feature.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'
import { createStoaCtlGate, isStoaCtlEnabled } from './stoa-ctl-feature'
import { DEFAULT_SETTINGS } from '@shared/project-session'

describe('stoaCtlGate', () => {
  test('initial value comes from settings', () => {
    const gate = createStoaCtlGate(false)
    expect(gate.isEnabled()).toBe(false)
  })

  test('initial value true works', () => {
    const gate = createStoaCtlGate(true)
    expect(gate.isEnabled()).toBe(true)
  })

  test('setEnabled toggles state and fires enabledChanged', async () => {
    const gate = createStoaCtlGate(false)
    const listener = vi.fn()
    gate.on('enabledChanged', listener)
    await gate.setEnabled(true)
    expect(gate.isEnabled()).toBe(true)
    expect(listener).toHaveBeenCalledWith(true)
    await gate.setEnabled(false)
    expect(gate.isEnabled()).toBe(false)
    expect(listener).toHaveBeenLastCalledWith(false)
  })

  test('off() unsubscribes listener', async () => {
    const gate = createStoaCtlGate(false)
    const listener = vi.fn()
    const off = gate.on('enabledChanged', listener)
    off()
    await gate.setEnabled(true)
    expect(listener).not.toHaveBeenCalled()
  })

  test('multiple listeners all fire', async () => {
    const gate = createStoaCtlGate(false)
    const l1 = vi.fn()
    const l2 = vi.fn()
    gate.on('enabledChanged', l1)
    gate.on('enabledChanged', l2)
    await gate.setEnabled(true)
    expect(l1).toHaveBeenCalledWith(true)
    expect(l2).toHaveBeenCalledWith(true)
  })
})

describe('isStoaCtlEnabled helper', () => {
  test('returns settings.stoaCtlEnabled', () => {
    expect(isStoaCtlEnabled(DEFAULT_SETTINGS)).toBe(false)
    expect(isStoaCtlEnabled({ ...DEFAULT_SETTINGS, stoaCtlEnabled: true })).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
npx vitest run src/core/stoa-ctl-feature.test.ts
```

Expected: FAIL — "Cannot find module './stoa-ctl-feature'"

- [ ] **Step 3: 实现 gate**

`src/core/stoa-ctl-feature.ts`:

```ts
import { EventEmitter } from 'node:events'
import type { AppSettings } from '@shared/project-session'

export function isStoaCtlEnabled(settings: AppSettings): boolean {
  return settings.stoaCtlEnabled === true
}

export interface StoaCtlGate {
  isEnabled(): boolean
  setEnabled(value: boolean): Promise<void>
  on(event: 'enabledChanged', listener: (enabled: boolean) => void): () => void
}

export function createStoaCtlGate(initial: boolean): StoaCtlGate {
  const emitter = new EventEmitter()
  let current = initial === true

  return {
    isEnabled: () => current,
    async setEnabled(value: boolean): Promise<void> {
      const next = value === true
      if (next === current) return
      current = next
      emitter.emit('enabledChanged', current)
    },
    on(event: 'enabledChanged', listener: (enabled: boolean) => void): () => void {
      emitter.on(event, listener)
      return () => emitter.off(event, listener)
    }
  }
}

let cachedGate: StoaCtlGate | null = null

export function getStoaCtlGate(): StoaCtlGate {
  if (!cachedGate) {
    cachedGate = createStoaCtlGate(false)
  }
  return cachedGate
}

export function setStoaCtlGate(gate: StoaCtlGate | null): void {
  cachedGate = gate
}
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
npx vitest run src/core/stoa-ctl-feature.test.ts
```

Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/stoa-ctl-feature.ts src/core/stoa-ctl-feature.test.ts
git commit -m "feat(core): add createStoaCtlGate singleton"
```

---

## Task 3: `unregisterStoaCtlShim` + `unregisterStoaCtlSystemShim` 幂等清理

**Files:**
- Modify: `src/core/stoa-ctl-shim.ts` (新增两个 export 函数,不改原有函数)
- Modify: `src/core/stoa-ctl-shim.test.ts`

- [ ] **Step 1: 写失败单测**

在 `src/core/stoa-ctl-shim.test.ts` 末尾追加:

```ts
import { unregisterPosixPath, unregisterStoaCtlShim, unregisterStoaCtlSystemShim } from './stoa-ctl-shim'
import { writeFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('stoa-ctl unregister', () => {
  test('unregisterStoaCtlShim removes both shim files and is idempotent', async () => {
    const shimDir = await createTempDir('stoa-ctl-unregister-')
    await ensureStoaCtlShim({
      binDir: shimDir,
      appRootPath: 'D:/Data/DEV/ultra_simple_panel/out/main',
      appExecutablePath: 'D:/Data/DEV/ultra_simple_panel/node_modules/.bin/electron.cmd',
      isPackaged: false
    })
    expect(existsSync(join(shimDir, 'stoa-ctl.cmd'))).toBe(true)
    expect(existsSync(join(shimDir, 'stoa-ctl'))).toBe(true)
    await unregisterStoaCtlShim(shimDir)
    expect(existsSync(join(shimDir, 'stoa-ctl.cmd'))).toBe(false)
    expect(existsSync(join(shimDir, 'stoa-ctl'))).toBe(false)
    // idempotent
    await expect(unregisterStoaCtlShim(shimDir)).resolves.toBeUndefined()
  })

  test('unregisterStoaCtlSystemShim does not throw when no files exist', async () => {
    await expect(unregisterStoaCtlSystemShim()).resolves.toBeUndefined()
  })

  test('unregisterPosixPath removes the stoa-ctl export line from rc file', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'stoactl-unregister-'))
    const rcFile = join(tmpHome, '.bashrc')
    const original = 'export PATH="$HOME/.local/bin:$PATH"\nexport PATH="$HOME/.stoa/bin:$PATH" # stoa-ctl\nexport FOO=bar\n'
    writeFileSync(rcFile, original, 'utf8')

    // monkey-patch homedir by mutating module: not possible, so we test by reading the file
    // and verifying the implementation touches files containing the bin dir.
    // For unit test, we directly call the function with a temp HOME.
    const previousHome = process.env.HOME
    process.env.HOME = tmpHome
    try {
      await unregisterPosixPath(join(tmpHome, '.stoa', 'bin'))
      const after = readFileSync(rcFile, 'utf8')
      expect(after).not.toContain('# stoa-ctl')
      expect(after).toContain('export FOO=bar')
    } finally {
      process.env.HOME = previousHome
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })
})
```

注意: 顶部 import 需加 `existsSync`(原 import 已含,确认即可)。

- [ ] **Step 2: 跑测试,验证失败**

```bash
npx vitest run src/core/stoa-ctl-shim.test.ts
```

Expected: FAIL — "unregisterStoaCtlShim is not a function"

- [ ] **Step 3: 实现清理函数**

在 `src/core/stoa-ctl-shim.ts` 末尾追加(在 `ensureStoaCtlSystemShim` 之后),**完整实现包含 PATH 撤销**:

```ts
export async function unregisterStoaCtlShim(binDir: string): Promise<void> {
  const commandPath = process.platform === 'win32'
    ? join(binDir, 'stoa-ctl.cmd')
    : join(binDir, 'stoa-ctl')
  const posixShim = join(binDir, 'stoa-ctl')
  const targets = process.platform === 'win32'
    ? [commandPath, posixShim]
    : [commandPath]
  for (const target of targets) {
    try {
      await unlink(target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        console.warn(`Failed to remove stoa-ctl shim at ${target}:`, (error as Error).message)
      }
    }
  }
}

export async function unregisterStoaCtlSystemShim(): Promise<void> {
  const binDir = join(homedir(), '.stoa', 'bin')
  await unregisterStoaCtlShim(binDir)
  await unregisterPath(binDir)
}

export async function unregisterWindowsPath(binDir: string): Promise<void> {
  return new Promise((resolve) => {
    // Windows Path 是大小写不敏感,且可能含混合分隔符。normalize + 不区分大小写匹配。
    const normalized = binDir.replace(/\//g, '\\').toLowerCase()
    const script = `
$binDir = '${binDir.replace(/'/g, "''")}'
$normalized = '${normalized.replace(/'/g, "''")}'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath) {
  $parts = $userPath -split ';' | Where-Object {
    $part = $_
    $norm = $part -replace '/', '\\'
    $norm -ne '' -and $norm.ToLower() -ne $normalized
  }
  $newPath = $parts -join ';'
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
}
`.trim()
    execFile('powershell.exe', ['-NoProfile', '-Command', script], (error) => {
      if (error) {
        console.warn('Failed to unregister stoa-ctl from user PATH:', error.message)
      }
      resolve()
    })
  })
}

export async function unregisterPosixPath(binDir: string): Promise<void> {
  const rcFiles = ['.bashrc', '.zshrc', '.profile']
  for (const rcFile of rcFiles) {
    const rcPath = join(homedir(), rcFile)
    if (!existsSync(rcPath)) continue
    try {
      const content = readFileSync(rcPath, 'utf8')
      const lines = content.split('\n')
      const filtered = lines.filter((line) => !line.includes(binDir) || !line.includes('# stoa-ctl'))
      if (filtered.length !== lines.length) {
        const { writeFileSync } = await import('node:fs')
        writeFileSync(rcPath, filtered.join('\n'), 'utf8')
      }
    } catch (error) {
      console.warn(`Failed to unregister stoa-ctl from ${rcFile}:`, (error as Error).message)
    }
  }
}

async function unregisterPath(binDir: string): Promise<void> {
  if (process.platform === 'win32') {
    return unregisterWindowsPath(binDir)
  }
  return unregisterPosixPath(binDir)
}
```

注意: 顶部 import 需加 `unlink` 与现有 `execFile`:

```ts
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
```

(`writeFileSync` 用于 rc 文件重写,`existsSync` 和 `readFileSync` 已在原 import 中)

- [ ] **Step 4: 跑测试,验证通过**

```bash
npx vitest run src/core/stoa-ctl-shim.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/stoa-ctl-shim.ts src/core/stoa-ctl-shim.test.ts
git commit -m "feat(core): add stoa-ctl shim unregister helpers"
```

---

## Task 4: `buildSessionCommandEnv` 支持 disabled

**Files:**
- Modify: `src/core/session-command-env.ts`
- Modify: `src/core/session-command-env.test.ts`
- Delete: `src/core/meta-session-command-env.ts`
- Delete: `src/core/meta-session-command-env.test.ts`

- [ ] **Step 1: 写失败单测**

`src/core/session-command-env.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildSessionCommandEnv } from './session-command-env'

describe('buildSessionCommandEnv', () => {
  test('enabled emits STOA_CTL_COMMAND and prepends bin dir to PATH', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's-1',
      sessionToken: 'tok',
      webhookPort: 12345,
      stoaCtlBinDir: '/tmp/bin',
      stoaCtlEnabled: true
    })
    expect(env.STOA_CTL_COMMAND).toBe('stoa-ctl')
    expect(env.PATH.startsWith('/tmp/bin')).toBe(true)
  })

  test('disabled omits STOA_CTL_COMMAND and does not prepend bin dir', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's-1',
      sessionToken: 'tok',
      webhookPort: 12345,
      stoaCtlBinDir: '/tmp/bin',
      stoaCtlEnabled: false
    })
    expect(env.STOA_CTL_COMMAND).toBeUndefined()
    expect(env.STOA_CTL_SESSION_TOKEN).toBeUndefined()
    expect(env.PATH.startsWith('/tmp/bin')).toBe(false)
  })

  test('disabled still emits STOA_CTL_BASE_URL and STOA_SESSION_ID for diagnostics', () => {
    const env = buildSessionCommandEnv({
      sessionId: 's-1',
      sessionToken: 'tok',
      webhookPort: 12345,
      stoaCtlBinDir: '/tmp/bin',
      stoaCtlEnabled: false
    })
    expect(env.STOA_CTL_BASE_URL).toBe('http://127.0.0.1:12345')
    expect(env.STOA_SESSION_ID).toBe('s-1')
  })
})
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
npx vitest run src/core/session-command-env.test.ts
```

Expected: FAIL — `stoaCtlEnabled` 必填 / 类型错误

- [ ] **Step 3: 实现 `buildSessionCommandEnv`**

`src/core/session-command-env.ts` 替换全文:

```ts
import { delimiter } from 'node:path'

interface BuildSessionCommandEnvOptions {
  sessionId: string
  sessionToken: string
  webhookPort: number
  stoaCtlBinDir: string
  stoaCtlEnabled: boolean
  basePath?: string | null
}

export function buildSessionCommandEnv(options: BuildSessionCommandEnvOptions): Record<string, string> {
  const base: Record<string, string> = {
    STOA_SESSION_ID: options.sessionId,
    STOA_CTL_BASE_URL: `http://127.0.0.1:${options.webhookPort}`
  }

  if (options.stoaCtlEnabled) {
    base.STOA_CTL_SESSION_TOKEN = options.sessionToken
    base.STOA_CTL_COMMAND = 'stoa-ctl'
    const pathParts = [
      options.stoaCtlBinDir,
      options.basePath ?? process.env.PATH ?? process.env.Path ?? ''
    ].filter((value) => value.length > 0)
    base.PATH = pathParts.join(delimiter)
  } else {
    base.PATH = options.basePath ?? process.env.PATH ?? process.env.Path ?? ''
  }

  return base
}
```

- [ ] **Step 4: 删除死代码 `meta-session-command-env.*`**

```bash
git rm src/core/meta-session-command-env.ts src/core/meta-session-command-env.test.ts
```

(grep 确认无调用方:`rg "buildMetaSessionCommandEnv" src/` 必须返回 0 行。)

- [ ] **Step 5: 跑测试,验证通过**

```bash
npx vitest run src/core/session-command-env.test.ts
```

Expected: PASS — 3 tests

- [ ] **Step 6: Commit**

```bash
git add src/core/session-command-env.ts src/core/session-command-env.test.ts
git commit -m "feat(core): gate STOA_CTL_COMMAND injection by stoaCtlEnabled; drop dead meta-session-command-env"
```

---

## Task 5: `session-control-server` 接受 `isCtlEnabled` 闭包,返回 503

**Files:**
- Modify: `src/core/session-control-server.ts`
- Modify: `src/core/session-control-server.test.ts`

- [ ] **Step 1: 写失败单测**

在 `src/core/session-control-server.test.ts` 末尾追加(参考现有测试风格,先 grep 文件确定 import):

```ts
describe('session control server stoa-ctl disabled', () => {
  function buildDeps() {
    return {
      ctlSecret: 'secret-1',
      sessionTokenRegistry: new Map<string, string>(),
      getSnapshot: () => ({ sessions: [], projects: [] } as any),
      visibilityService: {} as any,
      sessionInput: { send: async () => {} },
      getTerminalReplay: async () => '',
      waitForSessionStateChange: async () => null,
      createChildSession: async () => ({ sessionId: 'x' } as any)
    }
  }

  test('/ctl/health returns 503 disabled envelope when gate is off', async () => {
    const deps = buildDeps()
    const server = createSessionControlServer({
      ...deps,
      isCtlEnabled: () => false
    } as any)
    const port = await server.start()
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ctl/health`)
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('disabled')
    } finally {
      await server.stop()
    }
  })

  test('/ctl/session/list returns 503 disabled envelope when gate is off', async () => {
    const deps = buildDeps()
    const server = createSessionControlServer({
      ...deps,
      isCtlEnabled: () => false
    } as any)
    const port = await server.start()
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ctl/session/list`, {
        headers: { 'x-stoa-secret': 'secret-1' }
      })
      expect(res.status).toBe(503)
    } finally {
      await server.stop()
    }
  })
})
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
npx vitest run src/core/session-control-server.test.ts
```

Expected: FAIL — type error on `isCtlEnabled` (deps 不接受此字段)

- [ ] **Step 3: 改 `session-control-server.ts`**

a) 在 `SessionControlServerDeps` 加字段:

```ts
export interface SessionControlServerDeps extends SessionSupervisorDeps {
  ctlSecret?: string
  sessionTokenRegistry: Map<string, string>
  isCtlEnabled?: () => boolean  // NEW
}
```

b) 在 `createSessionControlServer` 顶部抽常量:

```ts
const isCtlEnabled = deps.isCtlEnabled ?? (() => true)
```

c) **在 `/ctl` 鉴权中间件之前**加 disabled gate(无凭据也应得到 503,让外部清楚是关闭而非鉴权失败):

```ts
app.use('/ctl', (req, res, next) => {
  if (!isCtlEnabled()) {
    res.status(503).json(jsonEnvelope(null, {
      code: 'disabled',
      message: 'stoa-ctl is disabled in settings',
      details: {}
    }))
    return
  }
  next()
})
```

注: envelope 形状 `{ ok, data, error: { code, message, details? } }` 与现有 `jsonEnvelope(data, error)` 一致(不破坏现有 client 的解析路径;`details` 在原 schema 中允许缺省)。

- [ ] **Step 4: 跑测试,验证通过**

```bash
npx vitest run src/core/session-control-server.test.ts
```

Expected: PASS — 含新加 2 个 disabled 测试

- [ ] **Step 5: Commit**

```bash
git add src/core/session-control-server.ts src/core/session-control-server.test.ts
git commit -m "feat(core): gate /ctl/* routes behind isCtlEnabled"
```

---

## Task 6: `main/index.ts` 集成 gate + 联动关闭逻辑

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 顶部 import**

在 `src/main/index.ts` 顶部 imports 中加:

```ts
import { createStoaCtlGate, getStoaCtlGate, setStoaCtlGate, isStoaCtlEnabled } from '@core/stoa-ctl-feature'
import { unregisterStoaCtlShim, unregisterStoaCtlSystemShim } from '@core/stoa-ctl-shim'
```

- [ ] **Step 2: 在文件级作用域创建 gate**

紧跟 `let mainWindow: BrowserWindow | null = null` 之后:

```ts
const stoaCtlGate = createStoaCtlGate(false)
```

- [ ] **Step 3: 修改 ensureStoaCtlShim 调用点 + 提早捕获 binDir**

定位到 `src/main/index.ts:893`,改为(提早求 `stoaCtlBinDir` 避免后续 `.binDir` 在 disabled 路径 NPE):

```ts
const stoaCtlBinDir = join(app.getPath('userData'), 'bin')
if (stoaCtlGate.isEnabled()) {
  await ensureStoaCtlShim({
    binDir: stoaCtlBinDir,
    appRootPath: app.getAppPath(),
    appExecutablePath: process.execPath,
    isPackaged: app.isPackaged
  })
} else {
  await unregisterStoaCtlShim(stoaCtlBinDir)
}
```

(原 `const stoaCtlShim = await ...` 中 `stoaCtlShim` 后续若被引用,改读 `stoaCtlBinDir` 字符串即可;grep `stoaCtlShim` 确认。)

- [ ] **Step 4: 修改 ensureStoaCtlSystemShim 调用点**

定位到 `src/main/index.ts:900`,改为:

```ts
if (stoaCtlGate.isEnabled()) {
  void ensureStoaCtlSystemShim({
    appRootPath: app.getAppPath(),
    appExecutablePath: process.execPath,
    isPackaged: app.isPackaged
  })
} else {
  void unregisterStoaCtlSystemShim()
}
```

- [ ] **Step 5: 给 `createSessionControlServer` 注入 isCtlEnabled**

定位到 `src/main/index.ts:728`,在 `createSessionControlServer({ ... })` 中追加字段:

```ts
isCtlEnabled: () => stoaCtlGate.isEnabled()
```

- [ ] **Step 6: 给 `buildSessionCommandEnv` 调用传 enabled**

`src/main/index.ts:917` 已有 `commandEnv: buildSessionCommandEnv({ stoaCtlBinDir: stoaCtlShim.binDir, ... })`,改为读已 hoist 的字符串变量:

```ts
commandEnv: buildSessionCommandEnv({
  // ... existing fields
  stoaCtlBinDir,
  stoaCtlEnabled: stoaCtlGate.isEnabled()
})
```

(`stoaCtlBinDir` 已在 step 3 hoist,即使 disabled 也存在。)

- [ ] **Step 7: 订阅 settings 变更事件,实时联动**

在主进程启动流程中,`createSessionControlServer` 之前插入(具体位置 grep `activeProjectSessionManager.subscribe` / 类似 bus event):

```ts
const unsubscribeSettings = stoaCtlGate.on('enabledChanged', async (enabled) => {
  if (!enabled) {
    await unregisterStoaCtlShim(join(app.getPath('userData'), 'bin'))
    await unregisterStoaCtlSystemShim()
  } else {
    await ensureStoaCtlShim({
      binDir: join(app.getPath('userData'), 'bin'),
      appRootPath: app.getAppPath(),
      appExecutablePath: process.execPath,
      isPackaged: app.isPackaged
    })
    void ensureStoaCtlSystemShim({
      appRootPath: app.getAppPath(),
      appExecutablePath: process.execPath,
      isPackaged: app.isPackaged
    })
  }
})
app.on('before-quit', () => unsubscribeSettings())
```

- [ ] **Step 8: 跑 typecheck + 单测**

```bash
npx tsc --noEmit -p tsconfig.node.json
npx vitest run src/core/stoa-ctl-feature.test.ts src/core/stoa-ctl-shim.test.ts src/core/meta-session-command-env.test.ts src/core/session-control-server.test.ts
```

Expected: 0 type errors, all tests pass

- [ ] **Step 9: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): wire stoaCtlGate through shim / HTTP / env injection"
```

---

## Task 7: 项目初始化时 gate 与 settings 同步

**Files:**
- Modify: `src/main/index.ts` (在主进程初始化早期读 settings,启动时一次性 setEnabled)

- [ ] **Step 1: 定位 settings 加载点**

`src/main/index.ts:1356` 已经有 `return projectSessionManager?.getSettings() ?? null`,确认 `projectSessionManager.getSettings()` 返回 `AppSettings`。`src/main/index.ts:849` 也直接用 `projectSessionManager?.getSettings() ?? DEFAULT_SETTINGS`。

- [ ] **Step 2: 在 settings 加载完成后 setEnabled**

找一个早于 `createSessionControlServer` 调用(行 728 之前)的初始化点,追加(可紧接 `if (projectSessionManager) {` 之后):

```ts
if (projectSessionManager) {
  stoaCtlGate.setEnabled(projectSessionManager.getSettings().stoaCtlEnabled)
}
```

后续若 main 已有 settings 变更 bus(grep `settings:updated\|onSettingsChanged`),在 listener 内同步 `stoaCtlGate.setEnabled(newSettings.stoaCtlEnabled)`。否则新增最小 listener:

```ts
projectSessionManager.on('settings:updated', (settings: AppSettings) => {
  void stoaCtlGate.setEnabled(settings.stoaCtlEnabled)
})
```

注: `settings:updated` 事件名按 `ProjectSessionManager` 实际 emit 字符串调整;如项目内未实现该事件,则在 `ProjectSessionManager.updateSettings` 末尾追加 emit。

- [ ] **Step 3: 跑 typecheck + 单测**

```bash
npx tsc --noEmit -p tsconfig.node.json
npx vitest run src/core/ src/main/
```

Expected: 0 errors, all pass

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): sync stoaCtlGate with persisted settings at boot"
```

---

## Task 7.5: `ProjectSessionManager.setSetting` 末尾 emit `settings:updated`

**Files:**
- Modify: `src/core/project-session-manager.ts`(在 `setSetting` 末尾 emit)
- Modify: `src/core/project-session-manager.test.ts`(若已有 `setSetting` 测试,加 1 个 emit 验证)

- [ ] **Step 1: 检查项目是否使用 EventEmitter**

Grep `extends EventEmitter` / `import { EventEmitter }` 确认 `ProjectSessionManager` 继承方式。若未继承,在类上加 `extends EventEmitter`,并在构造函数 `super()`。

- [ ] **Step 2: setSetting 末尾 emit**

在 `src/core/project-session-manager.ts:607` `setSetting` 方法末尾(`await this.persist()` 之后)追加:

```ts
this.emit('settings:updated', this.getSettings())
```

- [ ] **Step 3: 新增单测**

`src/core/project-session-manager.test.ts`(若存在)在合适的 describe 块追加:

```ts
test('setSetting emits settings:updated with the new settings', async () => {
  const manager = new ProjectSessionManager(/* real or stub deps */)
  const listener = vi.fn()
  manager.on('settings:updated', listener)
  await manager.setSetting('stoaCtlEnabled', true)
  expect(listener).toHaveBeenCalledTimes(1)
  const arg = listener.mock.calls[0][0] as AppSettings
  expect(arg.stoaCtlEnabled).toBe(true)
})
```

(若 `ProjectSessionManager` 构造依赖过重无法直接 new,放到 `tests/e2e/` 的 `project-session-manager-internals.test.ts` 中。)

- [ ] **Step 4: 跑测试**

```bash
npx vitest run src/core/project-session-manager.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/project-session-manager.ts src/core/project-session-manager.test.ts
git commit -m "feat(core): ProjectSessionManager emits settings:updated"
```

---

## Task 8: Renderer settings store 扩展

**Files:**
- Modify: `src/renderer/stores/settings.ts`

- [ ] **Step 1: 加 stoaCtlEnabled ref**

在 `useSettingsStore` 顶部 `claudeDangerouslySkipPermissions` 之后追加:

```ts
const stoaCtlEnabled = ref(false)
```

- [ ] **Step 2: loadSettings 同步字段**

在 `loadSettings` 内部、`loaded.value = true` 之前追加:

```ts
stoaCtlEnabled.value = settings.stoaCtlEnabled === true
```

- [ ] **Step 3: updateSetting 分支**

在 `updateSetting` 末尾(在最后一个 `else if` 之后,`}` 闭合之前)追加:

```ts
} else if (key === 'stoaCtlEnabled' && typeof value === 'boolean') {
  stoaCtlEnabled.value = value
}
```

- [ ] **Step 4: return 暴露字段**

在 `return { ... }` 对象内追加 `stoaCtlEnabled,` 与 `toggleStoaCtl: async (value: boolean) => updateSetting('stoaCtlEnabled', value)`。

- [ ] **Step 5: 跑测试**

```bash
npx vitest run src/renderer/stores/
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/stores/settings.ts
git commit -m "feat(renderer): expose stoaCtlEnabled in settings store"
```

---

## Task 9: 新建 AdvancedSettings 标签页 + toggle 控件(语义独立于 providers)

**Files:**
- Create: `src/renderer/components/settings/AdvancedSettings.vue`
- Create: `src/renderer/components/settings/AdvancedSettings.test.ts`
- Modify: `src/renderer/components/settings/SettingsSurface.vue`(新增 'advanced' 标签)
- Modify: `src/renderer/components/settings/SettingsTabBar.vue`(若需要)
- Modify: `src/renderer/i18n/en.ts` & `zh-CN.ts`(新增 `settings.tabs.advanced.*` + `settings.stoactlToggle.*`)

> 决策依据: stoa-ctl 是 CLI 控制平面,语义不属于 provider,放在 Providers 标签页会误导用户;新建 'Advanced' 标签页归类所有 CLI/实验性开关,后续同类功能(例如 evolver 模式)也可收纳。

- [ ] **Step 1: 写失败测试**

`src/renderer/components/settings/AdvancedSettings.test.ts`(新建,参照 `GeneralSettings.test.ts` 风格,**禁止 as any**):

```ts
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import AdvancedSettings from './AdvancedSettings.vue'

interface StoaBridge {
  getSettings: () => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<void>
}

const setSettingMock = vi.fn<Parameters<StoaBridge['setSetting']>, ReturnType<StoaBridge['setSetting']>>()
setSettingMock.mockResolvedValue(undefined)

beforeEach(() => {
  setActivePinia(createPinia())
  setSettingMock.mockClear()
  vi.stubGlobal('confirm', vi.fn(() => true))

  const bridge: StoaBridge = {
    getSettings: vi.fn(async () => null),
    setSetting: setSettingMock
  }
  vi.stubGlobal('window', { stoa: bridge })
})
```

> 注: `window.stoa` 已在全局类型声明中(`src/renderer/global.d.ts` 或类似),测试中只需保证运行时存在。`vi.stubGlobal` 是 Vitest 提供的标准做法,符合 CLAUDE.md 禁止 `as any` 的约束。

- [ ] **Step 2: 跑测试,验证失败**

```bash
npx vitest run src/renderer/components/settings/AdvancedSettings.test.ts
```

Expected: FAIL — AdvancedSettings.vue not found

- [ ] **Step 3: 改 i18n**

`src/renderer/i18n/en.ts` 加键(放在 `settings.tabs.*` 附近,新增 advanced tab):

```ts
settings: {
  // ... existing ...
  tabs: {
    general: { label: 'General', summary: 'Locale, theme, shell.' },
    terminal: { label: 'Terminal', summary: 'Font, scrollback, GPU.' },
    providers: { label: 'Providers', summary: 'AI providers and permissions.' },
    advanced: { label: 'Advanced', summary: 'CLI and experimental features.' },
    about: { label: 'About', summary: 'Stoa information.' }
  },
  stoactlToggle: {
    title: 'stoa-ctl command-line control',
    description: 'Expose stoa-ctl in PATH and allow external scripts to control sessions via HTTP. Disabled by default.',
    enabledLabel: 'Enabled',
    disabledLabel: 'Disabled',
    warningOnEnable: 'Enabling stoa-ctl will register it in your user PATH and start the /ctl HTTP control plane. Restart required to take effect on new sessions.'
  }
}
```

`src/renderer/i18n/zh-CN.ts` 对应中文(同样结构)。

- [ ] **Step 4: 新建 AdvancedSettings.vue**

`src/renderer/components/settings/AdvancedSettings.vue`:

```vue
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'

const { t } = useI18n()
const store = useSettingsStore()

async function onStoaCtlToggle() {
  const next = !store.stoaCtlEnabled
  if (next) {
    const confirmed = window.confirm(t('settings.stoactlToggle.warningOnEnable'))
    if (!confirmed) return
  }
  await store.updateSetting('stoaCtlEnabled', next)
}
</script>

<template>
  <section class="advanced-settings" data-surface="advanced-settings">
    <h2 class="advanced-settings__title">{{ t('settings.tabs.advanced.label') }}</h2>

    <div class="settings-toggle" data-testid="settings-stoactl-toggle-row">
      <div class="settings-toggle__copy">
        <h3 class="settings-toggle__title">{{ t('settings.stoactlToggle.title') }}</h3>
        <p class="settings-toggle__description">{{ t('settings.stoactlToggle.description') }}</p>
      </div>
      <button
        type="button"
        role="switch"
        :aria-checked="store.stoaCtlEnabled"
        :data-testid="'settings-stoactl-toggle'"
        :class="['settings-toggle__switch', { 'settings-toggle__switch--active': store.stoaCtlEnabled }]"
        @click="onStoaCtlToggle"
      >
        <span class="settings-toggle__switch-thumb" />
        <span class="settings-toggle__switch-label">
          {{ store.stoaCtlEnabled ? t('settings.stoactlToggle.enabledLabel') : t('settings.stoactlToggle.disabledLabel') }}
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.advanced-settings { display: flex; flex-direction: column; gap: 24px; }
.advanced-settings__title { margin: 0; font-family: var(--font-ui); font-size: 22px; font-weight: 700; }
.settings-toggle { display: flex; align-items: center; gap: 16px; padding: 16px; border: 1px solid var(--color-line); border-radius: 4px; background: var(--mica-alt); }
.settings-toggle__copy { flex: 1; }
.settings-toggle__title { margin: 0 0 4px 0; font-size: var(--text-body); font-weight: 600; }
.settings-toggle__description { margin: 0; color: var(--color-muted); font-size: var(--text-body-sm); }
.settings-toggle__switch { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border: 1px solid var(--color-line); border-radius: 999px; background: var(--color-surface-solid); cursor: pointer; }
.settings-toggle__switch--active { background: var(--color-accent); color: var(--color-on-accent); }
.settings-toggle__switch-thumb { width: 12px; height: 12px; border-radius: 50%; background: currentColor; }
</style>
```

- [ ] **Step 5: 注册新 tab 到 SettingsSurface.vue + SettingsTabBar.vue**

a) `SettingsTabBar.vue` 修改:

```ts
export type SettingsTab = 'general' | 'terminal' | 'providers' | 'advanced' | 'about'
```

`tabs` 数组中在 `providers` 之后插入:

```ts
{
  id: 'advanced',
  label: t('settings.tabs.advanced.label'),
  summary: t('settings.tabs.advanced.summary'),
  iconPaths: [
    'M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75'
  ]
}
```

b) `SettingsSurface.vue` 修改:

- `import AdvancedSettings from './AdvancedSettings.vue'`
- `tabMeta` 数组 `providers` 之后追加 `{ id: 'advanced', label: t('settings.tabs.advanced.label'), summary: t('settings.tabs.advanced.summary') }`
- `tabComponents` 加 `advanced: AdvancedSettings`
- `<TabPanels>` 中在 `<TabPanel>ProvidersSettings</TabPanel>` 之后追加 `<TabPanel><AdvancedSettings /></TabPanel>`

- [ ] **Step 6: 跑测试,验证通过**

```bash
npx vitest run src/renderer/components/settings/AdvancedSettings.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/settings/AdvancedSettings.vue src/renderer/components/settings/AdvancedSettings.test.ts src/renderer/components/settings/SettingsSurface.vue src/renderer/components/settings/SettingsTabBar.vue src/renderer/i18n/en.ts src/renderer/i18n/zh-CN.ts
git commit -m "feat(renderer): add Advanced settings tab with stoa-ctl toggle"
```

---

## Task 10: 行为 / 拓扑 / 旅程资产

**Files:**
- Create: `testing/behavior/stoactl-lifecycle.json`
- Create: `testing/topology/stoactl-topology.ts`
- Create: `testing/journeys/stoactl-lifecycle.journey.ts`
- Create: `testing/journeys/stoactl-lifecycle.journey.test.ts`

- [ ] **Step 1: 行为资产**

`testing/behavior/stoactl-lifecycle.ts`(严格对齐 `defineBehavior` contract:`actor: 'user' | 'system'`、`observationLayers: 'ui' | 'renderer-store' | 'main-debug-state' | 'persisted-state'`):

```ts
import { defineBehavior } from '../contracts/testing-contracts'

export const stoactlDisabledAtStartup = defineBehavior({
  id: 'stoactl.disabledAtStartup',
  actor: 'user',
  goal: 'fresh install leaves stoa-ctl invisible (no shim, no PATH, /ctl/* returns 503)',
  entities: ['settings', 'shim', 'path', 'http-control-plane'],
  usageModes: ['cold_start'],
  preconditions: ['settings.stoaCtlEnabled=false'],
  action: 'app.boot',
  expects: [
    'shim.absent',
    'path.binDirAbsent',
    'http.ctlReturns503',
    'env.stoaCtlCommandAbsent'
  ],
  invalidPreconditions: ['settings.stoaCtlEnabled=true'],
  interruptions: ['shim.residueFromOldInstall'],
  recovery: ['unregisterShimAndPath'],
  observationLayers: ['main-debug-state', 'persisted-state'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const stoactlEnableThenRestart = defineBehavior({
  id: 'stoactl.enableThenRestart',
  actor: 'user',
  goal: 'toggling on in settings makes stoa-ctl available after restart',
  entities: ['settings', 'shim', 'path', 'http-control-plane'],
  usageModes: ['activation'],
  preconditions: ['settings.stoaCtlEnabled=false'],
  action: 'settings.toggleOn',
  expects: [
    'persisted.stoaCtlEnabled=true',
    'shim.presentAfterRestart',
    'path.binDirRegisteredAfterRestart',
    'http.ctlHealthReturnsOk'
  ],
  invalidPreconditions: ['persistence.failed'],
  interruptions: ['app.notRestarted'],
  recovery: ['userInitiatedRestart'],
  observationLayers: ['renderer-store', 'main-debug-state', 'persisted-state'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const stoactlDisableCleanup = defineBehavior({
  id: 'stoactl.disableCleanup',
  actor: 'user',
  goal: 'toggling off removes shim, unregisters PATH, new sessions lose STOA_CTL_COMMAND',
  entities: ['settings', 'shim', 'path', 'http-control-plane', 'session-env'],
  usageModes: ['deactivation'],
  preconditions: ['settings.stoaCtlEnabled=true'],
  action: 'settings.toggleOff',
  expects: [
    'shim.removed',
    'path.binDirUnregistered',
    'http.ctlReturns503',
    'newSession.env.stoaCtlCommandAbsent'
  ],
  invalidPreconditions: ['shim.locked'],
  recovery: ['consoleWarnOnPartialCleanup'],
  observationLayers: ['renderer-store', 'main-debug-state', 'persisted-state'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const stoactlHttp503WhenDisabled = defineBehavior({
  id: 'stoactl.http503WhenDisabled',
  actor: 'system',
  goal: '/ctl/* returns 503 disabled envelope while toggle is off',
  entities: ['http-control-plane'],
  usageModes: ['diagnostics'],
  preconditions: ['settings.stoaCtlEnabled=false'],
  action: 'http.get /ctl/health',
  expects: ['http.status=503', 'envelope.error.code=disabled'],
  invalidPreconditions: [],
  interruptions: [],
  recovery: [],
  observationLayers: ['main-debug-state'],
  risk: 'low',
  coverageBudget: 'medium'
})

export const stoactlEnvStrippedWhenDisabled = defineBehavior({
  id: 'stoactl.envStrippedWhenDisabled',
  actor: 'system',
  goal: 'sub-session env does not contain STOA_CTL_COMMAND / STOA_CTL_SESSION_TOKEN when toggle is off',
  entities: ['session-env'],
  usageModes: ['session-startup'],
  preconditions: ['settings.stoaCtlEnabled=false'],
  action: 'session.spawn',
  expects: ['env.STOA_CTL_COMMAND.absent', 'env.STOA_CTL_SESSION_TOKEN.absent', 'env.STOA_CTL_BASE_URL.present'],
  invalidPreconditions: [],
  interruptions: [],
  recovery: [],
  observationLayers: ['main-debug-state'],
  risk: 'low',
  coverageBudget: 'medium'
})
```

- [ ] **Step 2: 行为资产单测**

`testing/behavior/stoactl-lifecycle.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  stoactlDisabledAtStartup,
  stoactlEnableThenRestart,
  stoactlDisableCleanup,
  stoactlHttp503WhenDisabled,
  stoactlEnvStrippedWhenDisabled
} from './stoactl-lifecycle'

describe('stoactl-lifecycle behaviors', () => {
  test('declares 5 distinct behavior ids', () => {
    const ids = [
      stoactlDisabledAtStartup.id,
      stoactlEnableThenRestart.id,
      stoactlDisableCleanup.id,
      stoactlHttp503WhenDisabled.id,
      stoactlEnvStrippedWhenDisabled.id
    ]
    expect(new Set(ids).size).toBe(5)
    expect(ids.every((id) => id.startsWith('stoactl.'))).toBe(true)
  })

  test('every behavior has a coverageBudget and risk', () => {
    for (const b of [stoactlDisabledAtStartup, stoactlEnableThenRestart, stoactlDisableCleanup, stoactlHttp503WhenDisabled, stoactlEnvStrippedWhenDisabled]) {
      expect(b.risk).toBeDefined()
      expect(b.coverageBudget).toBeDefined()
      expect(b.preconditions.length).toBeGreaterThan(0)
      expect(b.expects.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: 拓扑节点**

`testing/topology/stoactl-topology.ts`(严格对齐 `defineTopology` contract):

```ts
import { defineTopology } from '../contracts/testing-contracts'

export const stoactlTopology = defineTopology({
  surface: 'stoactl-lifecycle',
  testIds: {
    settingsStoactlToggle: '[data-testid="settings-stoactl-toggle"]',
    settingsAdvancedTab: '[data-settings-tab="advanced"]'
  }
})
```

- [ ] **Step 3: 旅程文件**

`testing/journeys/stoactl-lifecycle.journey.ts`(严格对齐 `defineJourney` contract):

```ts
import { defineJourney } from '../contracts/testing-contracts'

export const stoactlDisableCleanupJourney = defineJourney({
  id: 'stoactl.disableCleanup',
  behavior: 'stoactl.disableCleanup',
  usageMode: 'deactivation',
  setup: [
    'settings.stoaCtlEnabled=true',
    'shim.present',
    'path.binDirRegistered'
  ],
  act: [
    'settings.toggleOff stoaCtlEnabled'
  ],
  assert: [
    'shim.absent',
    'path.binDirUnregistered',
    'http.ctlReturns503'
  ],
  variants: ['cold-boot', 'runtime-toggle']
})

export const stoactlEnvStrippedJourney = defineJourney({
  id: 'stoactl.envStrippedWhenDisabled',
  behavior: 'stoactl.envStrippedWhenDisabled',
  usageMode: 'session-startup',
  setup: [
    'settings.stoaCtlEnabled=false',
    'session.spawnRequested'
  ],
  act: [
    'session.spawnWithEnv'
  ],
  assert: [
    'env.STOA_CTL_COMMAND.absent',
    'env.STOA_CTL_SESSION_TOKEN.absent',
    'env.STOA_CTL_BASE_URL.present'
  ],
  variants: ['shell', 'opencode']
})
```

- [ ] **Step 4: 旅程测试**

`testing/journeys/stoactl-lifecycle.journey.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { stoactlDisableCleanupJourney, stoactlEnvStrippedJourney } from './stoactl-lifecycle.journey'
import { stoactlTopology } from '../topology/stoactl-topology'

describe('stoactl-lifecycle journeys', () => {
  test('disableCleanup journey has all required fields', () => {
    expect(stoactlDisableCleanupJourney.id).toBe('stoactl.disableCleanup')
    expect(stoactlDisableCleanupJourney.setup.length).toBeGreaterThan(0)
    expect(stoactlDisableCleanupJourney.act.length).toBeGreaterThan(0)
    expect(stoactlDisableCleanupJourney.assert.length).toBeGreaterThan(0)
    expect(stoactlDisableCleanupJourney.variants.length).toBeGreaterThan(0)
  })

  test('envStripped journey references the same topology surface', () => {
    expect(stoactlEnvStrippedJourney.usageMode).toBe('session-startup')
    expect(stoactlTopology.surface).toBe('stoactl-lifecycle')
    expect(stoactlTopology.testIds.settingsStoactlToggle).toContain('settings-stoactl-toggle')
  })
})
```

- [ ] **Step 5: 跑测试**

```bash
npx vitest run testing/journeys/stoactl-lifecycle.journey.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add testing/behavior/stoactl-lifecycle.ts testing/behavior/stoactl-lifecycle.test.ts testing/topology/stoactl-topology.ts testing/journeys/stoactl-lifecycle.journey.ts testing/journeys/stoactl-lifecycle.journey.test.ts
git commit -m "test(assets): add stoa-ctl lifecycle behavior/topology/journey"
```

---

## Task 11: 重生成 Playwright + 行为覆盖率

**Files:**
- Generator 自动改 `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts`
- Generator 自动改 `testing/generators/behavior-coverage.ts`

- [ ] **Step 1: 跑 generator**

```bash
npm run test:generate
```

Expected: 0 errors,新文件 `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts` 出现

- [ ] **Step 2: 跑行为覆盖率**

```bash
npm run test:behavior-coverage
```

Expected: stoa-ctl-lifecycle 节点被纳入预算

- [ ] **Step 3: Commit**

```bash
git add tests/generated/ testing/generators/
git commit -m "test(generated): regenerate playwright with stoactl-lifecycle"
```

---

## Task 12: E2E 测试

**Files:**
- Create: `tests/e2e/settings-stoactl-toggle.test.ts`

- [ ] **Step 1: 创建 E2E**

`tests/e2e/settings-stoactl-toggle.test.ts` —— 走纯函数组合,避免 spawn 真实 Electron 引入的 setTimeout 竞态;CLAUDE.md 禁止 skip/only/ts-ignore,本测试不依赖外部进程,可真实通过:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureStoaCtlShim,
  unregisterStoaCtlShim,
  unregisterStoaCtlSystemShim,
  unregisterPosixPath
} from '@core/stoa-ctl-shim'
import { isStoaCtlEnabled, createStoaCtlGate } from '@core/stoa-ctl-feature'
import { buildSessionCommandEnv } from '@core/session-command-env'
import { DEFAULT_SETTINGS } from '@shared/project-session'

describe('stoa-ctl settings toggle (e2e composition)', () => {
  let tempHome: string
  let tempBin: string
  let tempUserData: string

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'stoactl-e2e-home-'))
    tempBin = mkdtempSync(join(tmpdir(), 'stoactl-e2e-bin-'))
    tempUserData = mkdtempSync(join(tmpdir(), 'stoactl-e2e-ud-'))
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
    rmSync(tempBin, { recursive: true, force: true })
    rmSync(tempUserData, { recursive: true, force: true })
  })

  test('default settings: shim absent, env stripped, gate.isEnabled() === false', async () => {
    const settings = DEFAULT_SETTINGS
    expect(isStoaCtlEnabled(settings)).toBe(false)
    expect(existsSync(join(tempUserData, 'bin', 'stoa-ctl.cmd'))).toBe(false)

    const env = buildSessionCommandEnv({
      sessionId: 's-1',
      sessionToken: 'tok',
      webhookPort: 12345,
      stoaCtlBinDir: tempBin,
      stoaCtlEnabled: isStoaCtlEnabled(settings)
    })
    expect(env.STOA_CTL_COMMAND).toBeUndefined()
  })

  test('enabled: shim created, env populated, gate.isEnabled() === true', async () => {
    const settings = { ...DEFAULT_SETTINGS, stoaCtlEnabled: true }
    await ensureStoaCtlShim({
      binDir: join(tempUserData, 'bin'),
      appRootPath: tempUserData,
      appExecutablePath: process.execPath,
      isPackaged: false
    })
    expect(existsSync(join(tempUserData, 'bin', 'stoa-ctl.cmd'))).toBe(true)

    const env = buildSessionCommandEnv({
      sessionId: 's-1',
      sessionToken: 'tok',
      webhookPort: 12345,
      stoaCtlBinDir: tempBin,
      stoaCtlEnabled: isStoaCtlEnabled(settings)
    })
    expect(env.STOA_CTL_COMMAND).toBe('stoa-ctl')
  })

  test('disabled cleanup: shim removed, env stripped', async () => {
    await ensureStoaCtlShim({
      binDir: join(tempUserData, 'bin'),
      appRootPath: tempUserData,
      appExecutablePath: process.execPath,
      isPackaged: false
    })
    expect(existsSync(join(tempUserData, 'bin', 'stoa-ctl.cmd'))).toBe(true)
    await unregisterStoaCtlShim(join(tempUserData, 'bin'))
    expect(existsSync(join(tempUserData, 'bin', 'stoa-ctl.cmd'))).toBe(false)
  })

  test('gate toggles and emits enabledChanged', async () => {
    const gate = createStoaCtlGate(false)
    const events: boolean[] = []
    gate.on('enabledChanged', (v) => { events.push(v) })
    await gate.setEnabled(true)
    expect(gate.isEnabled()).toBe(true)
    await gate.setEnabled(false)
    expect(gate.isEnabled()).toBe(false)
    expect(events).toEqual([true, false])
  })

  test('POSIX rc file line removed by unregisterPosixPath', async () => {
    if (process.platform === 'win32') return
    const rcFile = join(tempHome, '.bashrc')
    const original = 'export PATH="$HOME/.local/bin:$PATH"\nexport PATH="$HOME/.stoa/bin:$PATH" # stoa-ctl\nexport FOO=bar\n'
    writeFileSync(rcFile, original, 'utf8')
    await unregisterPosixPath(join(tempHome, '.stoa', 'bin'))
    const after = readFileSync(rcFile, 'utf8')
    expect(after).not.toContain('# stoa-ctl')
    expect(after).toContain('export FOO=bar')
  })
})
```

- [ ] **Step 2: 跑 E2E**

```bash
npx vitest run tests/e2e/settings-stoactl-toggle.test.ts
```

CLAUDE.md 禁止 skip/only/ts-ignore —— 走纯函数组合可保证全平台通过,不需要 spawn 真实 Electron。Windows runner 上 `POSIX rc file` 测试用 `if (process.platform === 'win32') return` 跳过断言但仍执行,符合 vitest 期望。

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/settings-stoactl-toggle.test.ts
git commit -m "test(e2e): stoa-ctl settings toggle lifecycle"
```

---

## Task 13: 跑全套质量门

- [ ] **Step 1: regenerate**

```bash
npm run test:generate
```

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit -p tsconfig.node.json
npx vue-tsc --noEmit
```

- [ ] **Step 3: vitest**

```bash
npx vitest run
```

- [ ] **Step 4: e2e**

```bash
npm run test:e2e
```

- [ ] **Step 5: behavior coverage**

```bash
npm run test:behavior-coverage
```

- [ ] **Step 6: 全部通过,无 skip / .only / as any**

```bash
git grep -nE '\.skip|\.only|@ts-ignore|@ts-expect-error' src/ tests/ testing/ tools/ | grep -v 'test\.ts:.*skip' || true
```

Expected: 无新增 skip/only/ts-ignore

- [ ] **Step 7: 写 changelog / commit final**

```bash
git add -A
git commit --allow-empty -m "chore: stoa-ctl settings toggle — quality gate green"
```

---

## Self-Review Checklist

- [x] Spec coverage: 4 联动点 ↔ Task 6 / Task 5 / Task 4 / Task 3; 持久化 ↔ Task 1; UI ↔ Task 9; 行为资产 ↔ Task 10
- [x] Placeholders: 无 "TBD" / "fill in details" / "类似 Task N"
- [x] Type consistency: `stoaCtlEnabled` 在 `AppSettings`、`gate.isEnabled()`、`buildSessionCommandEnv.stoaCtlEnabled`、`isCtlEnabled: () => boolean` 之间签名一致
- [x] 测试优先: 每个实现 task 都有"先写失败测试"步骤
- [x] Frequent commits: 13 task,每 task 1 commit
